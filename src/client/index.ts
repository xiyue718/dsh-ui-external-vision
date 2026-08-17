/**
 * @dsh-external/ui-external-vision — browser half.
 * Provides an "外接识图" settings page. The API key is stored through the
 * project credentials service, matching the Models settings page.
 */
import React, { useEffect, useState } from 'react'

export const inject = ['slots', 'connection']

const API_PREFIX = '/@dsh-external/ui-external-vision/api'
const EXTERNAL_VISION_API_KEY_REF = 'EXTERNAL_VISION_API_KEY'

interface VisionConfig {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}

const DEFAULT_CONFIG: VisionConfig = {
  provider: '',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.5-omni-plus',
  apiKey: '',
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-primary, #ccc)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  width: '100%',
  boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-primary, #ccc)',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-primary)',
}

function VisionSettingsPage({ api }: any) {
  const [config, setConfig] = useState<VisionConfig>({ ...DEFAULT_CONFIG })
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let current = true
    api.credentials?.describe({ refs: [EXTERNAL_VISION_API_KEY_REF] })
      .then((response: any) => {
        if (!current || !response?.result?.ok) return
        const info = response.result.value.credentials?.[EXTERNAL_VISION_API_KEY_REF]
        setKeyConfigured(info?.configured === true)
      })
      .catch(() => { /* Keep unconfigured on failure. */ })
    fetch(`${API_PREFIX}/config`)
      .then(response => response.json())
      .then((data: any) => {
        if (!current) return
        setConfig(current => ({
          ...current,
          provider: typeof data.provider === 'string' ? data.provider : DEFAULT_CONFIG.provider,
          baseUrl: typeof data.baseUrl === 'string' && data.baseUrl !== '' ? data.baseUrl : DEFAULT_CONFIG.baseUrl,
          model: typeof data.model === 'string' && data.model !== '' ? data.model : DEFAULT_CONFIG.model,
        }))
      })
      .catch(() => { /* Keep defaults when the config endpoint is unavailable. */ })
    return () => { current = false }
  }, [api])

  function update(field: 'provider' | 'baseUrl' | 'model', value: string) {
    setConfig(current => ({ ...current, [field]: value }))
    setSaved(false)
    setError('')
  }

  async function save() {
    if (config.provider.trim() === '') {
      setError('请填写模型提供方名称')
      return
    }
    if (config.baseUrl.trim() === '' || config.model.trim() === '') {
      setError('请填写 Base URL 和模型名称')
      return
    }
    if (config.apiKey.trim() === '' && !keyConfigured) {
      setError('请填写 API Key')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (config.apiKey.trim() !== '') {
        await api.credentials.set({ ref: EXTERNAL_VISION_API_KEY_REF, value: config.apiKey.trim() })
      }
      const next = {
        provider: config.provider.trim(),
        baseUrl: config.baseUrl.trim(),
        model: config.model.trim(),
      }
      await fetch(`${API_PREFIX}/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      setConfig(current => ({ ...current, ...next, apiKey: '' }))
      setKeyConfigured(true)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, key: 'provider' | 'baseUrl' | 'model', placeholder: string) =>
    React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      React.createElement('span', null, label),
      React.createElement('input', {
        type: 'text',
        value: config[key],
        placeholder,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => update(key, event.target.value),
        style: inputStyle,
      }),
    )

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px', fontSize: 13, lineHeight: 1.6 } },
    React.createElement('h3', { style: { margin: 0, fontSize: 15 } }, '外接识图'),
    React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)' } },
      '当前模型不支持识图时，自动拦截本地图片识别和图片 URL 识别。非敏感配置通过项目存储持久化保存；API Key 通过项目凭证服务保存，与“模型”设置页一致；不会从文件、环境变量或远程接口读取。',
    ),
    field('模型提供方（服务商名称）', 'provider', '例如：阿里云百炼'),
    field('Base URL', 'baseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    field('模型名称', 'model', 'qwen3.5-omni-plus'),
    React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      React.createElement('span', null, 'API Key'),
      React.createElement('input', {
        type: 'password',
        value: config.apiKey,
        placeholder: keyConfigured ? '已配置（留空则保持不变）' : '请输入 API Key',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          setConfig(current => ({ ...current, apiKey: event.target.value }))
          setSaved(false)
          setError('')
        },
        style: inputStyle,
        autoComplete: 'off',
      }),
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      React.createElement('button', { type: 'button', onClick: () => void save(), disabled: saving, style: buttonStyle }, saving ? '保存中…' : '保存'),
      saved ? React.createElement('span', { style: { color: 'var(--dsw-alias-state-success-primary, #2a7a32)', fontSize: 12 } }, '已保存') : null,
      error !== '' ? React.createElement('span', { style: { color: 'var(--dsw-alias-state-error-primary, #d33)', fontSize: 12 } }, error) : null,
    ),
  )
}

export function apply(ctx: any): void {
  const connection = ctx.get('connection')
  const api = connection?.api

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'external-vision-config',
      order: 40,
      label: () => '外接识图',
      inject: () => ({ api }),
    }, VisionSettingsPage),
  )
}
