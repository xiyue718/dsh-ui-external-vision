/**
 * @dsh-external/ui-external-vision — host half.
 * Calls an OpenAI-compatible external VL model to recognize images. The API
 * key is read from the project credentials service, matching the Models page.
 * Local image paths are intercepted at `read_image`; image URLs in user
 * messages are recognized automatically before the model request is built.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'
import z from 'schemastery'

export const name = '@dsh-external/ui-external-vision'
export const inject = ['webServer', 'llm', 'fs', 'credentials', 'storageDomain']

const EXTERNAL_VISION_API_KEY_REF = 'EXTERNAL_VISION_API_KEY'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_URL_RE = /https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|bmp|avif)(?:\?[^\s<>"']*)?/gi
const FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export interface Config {
  /** Default OpenAI-compatible base URL, overridable from the settings page. */
  baseUrl: string
  /** Default external vision model, overridable from the settings page. */
  model: string
}

export const Config = z.object({
  baseUrl: z.string().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  model: z.string().default('qwen3.5-omni-plus'),
})

const MIME_MAP: Record<string, string> = {
  jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', avif: 'avif',
}

const visionConfigSchema = zod.object({
  provider: zod.string(),
  baseUrl: zod.string(),
  model: zod.string(),
})

const VISION_DOMAIN_SPEC = defineDomain({
  name: 'dsh_external_vision',
  version: 1,
  tables: {
    config: domainTable<string, zod.infer<typeof visionConfigSchema>>(visionConfigSchema),
  },
})

let visionConfig: { baseUrl: string; model: string } | null = null

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer | string) => { data += chunk })
    req.on('end', () => resolvePromise(data))
    req.on('error', reject)
  })
}

function mimeFromUrl(imageUrl: string): string {
  try {
    const pathname = new URL(imageUrl).pathname.toLowerCase()
    const ext = pathname.split('.').pop() ?? ''
    return `image/${MIME_MAP[ext] || 'jpeg'}`
  } catch {
    return 'image/jpeg'
  }
}

/**
 * Some image CDNs (e.g. iconfont's alicdn) reject requests without a
 * Referer. Use the known site referer for iconfont, otherwise the URL origin.
 */
function refererForUrl(imageUrl: string): string {
  try {
    const parsed = new URL(imageUrl)
    if (parsed.hostname === 'iconfont.alicdn.com' || parsed.hostname.endsWith('.alicdn.com')) {
      return 'https://www.iconfont.cn/'
    }
    return `${parsed.origin}/`
  } catch {
    return ''
  }
}

/**
 * Fetch a remote image into memory and return a base64 data URL. Nothing is
 * written to disk; this also avoids relying on the external VL provider being
 * able to fetch the URL (many CDNs block third-party fetchers).
 */
async function fetchImageDataUrl(imageUrl: string, signal?: AbortSignal): Promise<string> {
  const referer = refererForUrl(imageUrl)
  const response = await (globalThis as any).fetch(imageUrl, {
    redirect: 'follow',
    signal,
    headers: {
      'User-Agent': FETCH_USER_AGENT,
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      ...(referer === '' ? {} : { Referer: referer }),
    },
  })
  if (!response.ok) {
    throw new Error(`failed to fetch image: HTTP ${response.status} ${response.statusText ?? ''}`.trim())
  }
  const contentLength = Number(response.headers.get('content-length') ?? '0')
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error('image exceeds 20MB limit')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('image exceeds 20MB limit')
  }
  const contentType = response.headers.get('content-type') ?? ''
  const mime = contentType.startsWith('image/')
    ? contentType.split(';')[0].trim()
    : mimeFromUrl(imageUrl)
  return `data:${mime};base64,${buffer.toString('base64')}`
}

async function resolveImageSource(imagePath?: string, imageUrl?: string, signal?: AbortSignal): Promise<string> {
  if (imageUrl !== undefined && imageUrl !== '') {
    if (imageUrl.startsWith('data:')) return imageUrl
    return fetchImageDataUrl(imageUrl, signal)
  }
  if (imagePath === undefined || imagePath === '') throw new Error('imagePath or imageUrl is required')
  const resolved = resolve(imagePath)
  if (!existsSync(resolved)) throw new Error(`file not found: ${resolved}`)
  const ext = extname(resolved).toLowerCase().replace('.', '')
  const data = readFileSync(resolved)
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('image exceeds 20MB limit')
  return `data:image/${MIME_MAP[ext] || 'jpeg'};base64,${data.toString('base64')}`
}

function callVision(baseUrl: string, apiKey: string, model: string, imageSource: string, prompt: string): Promise<string> {
  const url = new URL(baseUrl.replace(/\/?$/, '/') + 'chat/completions')
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: imageSource } },
      { type: 'text', text: prompt },
    ] }],
    stream: false,
    max_tokens: 1024,
  })
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolvePromise, reject) => {
    const req = transport.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== undefined && res.statusCode >= 400) {
          reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`))
          return
        }
        try {
          const parsed = JSON.parse(data)
          const content = parsed?.choices?.[0]?.message?.content
          resolvePromise(typeof content === 'string' ? content : JSON.stringify(content ?? data))
        } catch {
          resolvePromise(data)
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function imageUrlsFromText(text: string): string[] {
  const urls = new Set<string>()
  const matches = text.match(IMAGE_URL_RE)
  if (matches !== null) {
    for (const match of matches) urls.add(match)
  }
  return [...urls]
}

function imageUrlsFromMessages(messages: any[]): string[] {
  const urls: string[] = []
  for (const message of messages) {
    if (message?.source?.kind !== 'user') continue
    for (const block of message.content ?? []) {
      if (block?.type === 'text') {
        urls.push(...imageUrlsFromText(block.text))
      }
    }
  }
  return [...new Set(urls)]
}

async function resolveApiKey(ctx: any): Promise<string> {
  const resolved = await ctx.credentials?.resolve(EXTERNAL_VISION_API_KEY_REF)
  return resolved?.value ?? ''
}

async function shouldIntercept(ctx: any, agent: any, signal: AbortSignal): Promise<boolean> {
  const llm = ctx.llm
  if (llm === undefined) return false
  const routed = agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? agent?.options?.provider
  const model = routed?.model ?? agent?.options?.model
  if (provider === undefined || model === undefined) return false
  try {
    const info = await llm.resolveModelInfo(provider, model, signal)
    if (info?.inputModalities !== undefined && info.inputModalities.includes('image')) return false
  } catch {
    return false
  }
  return (await resolveApiKey(ctx)) !== ''
}

interface VisionUrlResult {
  url: string
  text: string
  ok: boolean
}

async function describeImageUrls(ctx: any, config: Config, urls: string[], signal: AbortSignal): Promise<VisionUrlResult[]> {
  const apiKey = await resolveApiKey(ctx)
  if (apiKey === '') return []
  const baseUrl = visionConfig?.baseUrl ?? config.baseUrl
  const model = visionConfig?.model ?? config.model
  const results: VisionUrlResult[] = []
  for (const url of urls) {
    try {
      const imageSource = await resolveImageSource(undefined, url, signal)
      const text = await callVision(baseUrl, apiKey, model, imageSource, '请详细描述这张图片的内容。')
      results.push({ url, text, ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ url, text: message, ok: false })
    }
  }
  return results
}

function createVisionContextMessage(results: VisionUrlResult[]): UserMessage {
  const successes = results.filter(result => result.ok)
  const failures = results.filter(result => !result.ok)
  const lines = [
    ...successes.map(({ url, text }) => `- 图片地址：${url}\n  内容：${text}`),
    ...failures.map(({ url, text }) => `- 图片地址：${url}\n  失败原因：${text}`),
  ]
  const header = successes.length > 0
    ? '[外接识图] 以下图片 URL 的识别结果：'
    : '[外接识图] 以下图片 URL 识别失败：'
  return createUserMessage({
    content: [{ type: 'text', text: `${header}\n${lines.join('\n')}` }],
    source: { kind: 'plugin', plugin: name },
  })
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const storageDomain = (ctx as any).storageDomain
  let visionDomain: any
  if (storageDomain !== undefined) {
    try {
      visionDomain = await storageDomain.open(VISION_DOMAIN_SPEC)
      const saved = visionDomain.table('config').get('main')
      if (saved !== undefined) {
        visionConfig = { baseUrl: saved.baseUrl, model: saved.model }
      }
      ctx.effect(() => () => { void visionDomain?.close?.() }, '@dsh-external/ui-external-vision: storage domain')
    } catch {
      visionDomain = undefined
    }
  }

  ctx.effect(() => (ctx as any).webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/ui-external-vision/api',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname

      if (req.method === 'GET' && pathname === '/@dsh-external/ui-external-vision/api/status') {
        sendJson(res, 200, { ok: true, defaultBaseUrl: config.baseUrl, defaultModel: config.model })
        return
      }

      if (req.method === 'GET' && pathname === '/@dsh-external/ui-external-vision/api/config') {
        const saved = visionDomain?.table('config').get('main')
        sendJson(res, 200, {
          provider: saved?.provider ?? '',
          baseUrl: visionConfig?.baseUrl ?? config.baseUrl,
          model: visionConfig?.model ?? config.model,
        })
        return
      }

      if (req.method === 'POST' && pathname === '/@dsh-external/ui-external-vision/api/config') {
        let body: any
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
        const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '' ? body.baseUrl : config.baseUrl
        const model = typeof body.model === 'string' && body.model.trim() !== '' ? body.model : config.model
        visionConfig = { baseUrl, model }
        await visionDomain?.table('config').put('main', { provider, baseUrl, model })
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/@dsh-external/ui-external-vision/api/vision') {
        let body: any
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
        if (apiKey === '') {
          const resolved = await (ctx as any).credentials?.resolve(EXTERNAL_VISION_API_KEY_REF)
          apiKey = resolved?.value ?? ''
        }
        if (apiKey === '') {
          sendJson(res, 400, { error: 'apiKey is required; configure it in the 外接识图 settings page' })
          return
        }
        const imagePath = typeof body.imagePath === 'string' ? body.imagePath : undefined
        const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : undefined
        const prompt = typeof body.prompt === 'string' && body.prompt.trim() !== '' ? body.prompt : '请详细描述这张图片的内容。'
        const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '' ? body.baseUrl : config.baseUrl
        const model = typeof body.model === 'string' && body.model.trim() !== '' ? body.model : config.model
        try {
          const imageSource = await resolveImageSource(imagePath, imageUrl)
          const text = await callVision(baseUrl, apiKey, model, imageSource, prompt)
          sendJson(res, 200, { text })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 500, { error: message })
        }
        return
      }

      sendJson(res, 404, { error: 'not found' })
    },
  }), '@dsh-external/ui-external-vision: api')

  ctx.on('agent/pre-step' as any, async ({ agent, messages, signal }: any, next: any): Promise<any> => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    const urls = imageUrlsFromMessages(messages)
    if (urls.length === 0) return decision
    if (!(await shouldIntercept(ctx, agent, signal))) return decision
    const descriptions = await describeImageUrls(ctx, config, urls, signal)
    if (descriptions.length === 0) return decision
    const context = createVisionContextMessage(descriptions)
    const lastClaimedIndex = decision.messages.findLastIndex((message: any) => messages.includes(message))
    const entered = lastClaimedIndex >= 0
      ? [...decision.messages.slice(0, lastClaimedIndex + 1), context, ...decision.messages.slice(lastClaimedIndex + 1)]
      : [...decision.messages, context]
    return { kind: 'enter', messages: entered }
  })

  ctx.on('tools/execute' as any, async (exec: any, next: any): Promise<any> => {
    if (exec.name !== 'read_image') return next()
    const llm = (ctx as any).llm
    const agent = exec.agent
    const routed = agent?.session?.requestHeader?.()?.config
    const provider = routed?.provider ?? agent?.options?.provider
    const model = routed?.model ?? agent?.options?.model
    if (provider === undefined || model === undefined || llm === undefined) return next()
    let info: any
    try {
      info = await llm.resolveModelInfo(provider, model, exec.signal)
    } catch {
      return next()
    }
    if (info.inputModalities !== undefined && info.inputModalities.includes('image')) return next()
    const filePath = typeof exec.arguments?.file_path === 'string' ? exec.arguments.file_path : ''
    const imageUrl = typeof exec.arguments?.url === 'string' ? exec.arguments.url
      : typeof exec.arguments?.imageUrl === 'string' ? exec.arguments.imageUrl
      : typeof exec.arguments?.file_url === 'string' ? exec.arguments.file_url : ''
    if (filePath === '' && imageUrl === '') return next()
    try {
      let imageSource: string
      if (imageUrl !== '') {
        imageSource = await resolveImageSource(undefined, imageUrl, exec.signal)
      } else {
        const fs = (ctx as any).fs
        let data: Uint8Array
        if (fs !== undefined) {
          const cwd = agent?.session?.header?.cwd
          const target = await fs.resolve(filePath, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
          data = await fs.readBytes(target, exec.signal, MAX_IMAGE_BYTES)
        } else {
          const resolved = resolve(filePath)
          if (!existsSync(resolved)) throw new Error(`file not found: ${resolved}`)
          data = readFileSync(resolved)
        }
        const ext = extname(filePath).toLowerCase().replace('.', '')
        imageSource = `data:image/${MIME_MAP[ext] || 'jpeg'};base64,${Buffer.from(data).toString('base64')}`
      }
      const resolvedCredential = await (ctx as any).credentials?.resolve(EXTERNAL_VISION_API_KEY_REF)
      const apiKey = resolvedCredential?.value ?? ''
      if (apiKey === '') return next()
      const text = await callVision(visionConfig?.baseUrl ?? config.baseUrl, apiKey, visionConfig?.model ?? config.model, imageSource, '请详细描述这张图片的内容。')
      return {
        isError: false,
        value: { description: text },
        content: [{ type: 'text', text }],
      }
    } catch {
      return next()
    }
  })
}
