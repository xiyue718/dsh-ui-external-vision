# @dsh-external/ui-external-vision

外接模型识图插件：当当前模型不支持识图但需要识别图片时，通过外部 VL 模型（默认 `qwen3.5-omni-plus`，OpenAI 兼容接口）识别图片并返回文字描述。

## 功能

- 在“设置”中新增“外接识图”配置页面。
- **URL 自动识别**：当用户消息中包含图片 URL、且当前模型不支持图片输入时，插件会自动在模型请求前下载该 URL（仅内存，不写盘），调用外部 VL 模型识别，并把识别结果作为上下文注入给 AI。
- **防盗链兼容**：下载图片时会自动携带合适的 `Referer`（iconfont/alicdn 使用 `https://www.iconfont.cn/`，其他 URL 使用同源地址），降低 CDN 403 拒绝概率。
- **失败可见**：某个 URL 获取或识别失败时，插件会把失败原因注入上下文，不再静默跳过。
- **本地图片自动调用**：当 AI 调用 `read_image` 工具、但当前模型不支持图片输入时，插件会自动调用外部 VL 模型识别图片，并把文字描述作为工具结果返回给 AI。
- `read_image` 拦截同时支持 `file_path` 与 `url` / `imageUrl` / `file_url` 参数。
- 不再提供手动“识图”视图。

## 配置页面

在 DSH Web 中进入：

```text
设置 → 外接识图
```

可配置：

| 配置项 | 说明 |
|---|---|
| 模型提供方 | 服务商名称，例如“阿里云百炼” |
| Base URL | OpenAI 兼容接口地址 |
| 模型名称 | 外部视觉模型名 |
| API Key | 用户手动输入的 API Key |

### 配置规则

- **API Key 必须由用户手动输入**。
- API Key 通过项目凭证服务保存，与“模型”设置页的实现方式一致。
- 禁止从外部文件、环境变量或远程接口读取 API Key。
- 模型提供方、Base URL、模型名称通过项目 storage domain 持久化保存，并同步到 host 内存供自动识图使用。
- 保存时会校验：
  - 模型提供方不能为空；
  - Base URL 和模型名称不能为空；
  - 首次保存时 API Key 不能为空。
- 已配置 API Key 后，再次保存可留空表示保持不变。
- 保存成功后显示“已保存”提示。

## API

### 获取默认配置

```http
GET /@dsh-external/ui-external-vision/api/status
```

响应：

```json
{
  "ok": true,
  "defaultBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "defaultModel": "qwen3.5-omni-plus"
}
```

> 该接口不返回 API Key。

### 获取/保存非敏感配置（项目持久化）

```http
GET /@dsh-external/ui-external-vision/api/config
```

```http
POST /@dsh-external/ui-external-vision/api/config
Content-Type: application/json
```

请求体：

```json
{
  "provider": "阿里云百炼",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen3.5-omni-plus"
}
```

保存设置页面时，客户端会自动调用该接口，把非敏感配置通过项目 storage domain 持久化保存，并同步到 host 内存供自动识图使用。

### 识图

```http
POST /@dsh-external/ui-external-vision/api/vision
Content-Type: application/json
```

请求体：

```json
{
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen3.5-omni-plus",
  "imagePath": "C:\\Users\\...\\image.png",
  "prompt": "请详细描述这张图片的内容。"
}
```

或：

```json
{
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen3.5-omni-plus",
  "imageUrl": "https://example.com/image.png",
  "prompt": "用中文描述这张图片"
}
```

使用 `imageUrl` 时，host 会先把远程图片下载到内存并转为 base64 data URL，再发送给外部 VL 模型；不会写入磁盘，也不依赖外部模型自行抓取 URL。

API Key 由 host 从项目凭证服务中读取，不需要在请求体中传递。

成功响应：

```json
{
  "text": "图片描述文字..."
}
```

失败响应：

```json
{
  "error": "apiKey is required; configure it in the 外接识图 settings page"
}
```

## 使用方式

1. 打开 DSH Web。
2. 进入“设置 → 外接识图”。
3. 填写模型提供方、Base URL、模型名称和 API Key。
4. 点击“保存”。
5. 进入任意会话。
6. 直接发送图片 URL（如 `https://example.com/image.png`），插件会在当前模型不支持图片输入时自动识别并把描述注入给 AI。
7. 当 AI 调用 `read_image` 且当前模型不支持图片输入时，插件也会自动调用外部模型识别图片并把结果返回给 AI。

## 安装

### 方式一：超级模组注入器

```text
dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-external-vision"}
dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-external-vision"}
```

### 方式二：使用 dsh 命令安装（项目官方方式）

如果你已安装 `dsh` CLI，可以按项目官方教程使用 `dsh plugin` 命令安装：

```bash
# 从本地插件目录安装
dsh plugin --profile web add C:/Users/<user>/.dsh/plugins/ui-external-vision

# 或从 GitHub 仓库安装
dsh plugin --profile web add github:xiyue718/dsh-ui-external-vision
```

安装后启动：

```bash
dsh --profile web
```

查看组合配置：

```bash
dsh --profile web --dump-config
```

详细命令说明见项目文档：`docs/user/develop/basic/publish.md`。

## 安全说明

- API Key 通过项目凭证服务保存，不会写入浏览器本地、环境变量或远程服务。
- 识图请求时，API Key 仅随本次请求发送到用户配置的外部模型接口。
- 本地图片会转换为 base64 后发送到外部模型接口。
- 远程图片 URL 会在 host 内存中下载并转换为 base64 后发送到外部模型接口，不会写入磁盘。
- 请确保外部模型接口可信，并注意按量付费。

## 构建产物

- host：`lib/index.js`
- client：`lib/client.js`
- 打包文件：`dsh-external-ui-external-vision-0.0.1.tgz`
