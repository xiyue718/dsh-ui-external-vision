[中文](./README.md) | [English](./README_EN.md)

# @dsh-external/ui-external-vision

## 介绍

`ui-external-vision` 是 DSH Web 客户端的“外接模型识图”插件。当当前模型不支持识图但需要识别图片时，它会通过外部 VL 模型（默认 `qwen3.5-omni-plus`，OpenAI 兼容接口）识别图片并返回文字描述，支持本地图片路径和图片 URL 两种来源。

## 安装

### 方式一：超级模组注入器

```text
dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-external-vision"}
dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-external-vision"}
```

打开或刷新 DSH Web，进入“设置 → 外接识图”。

### 方式二：dsh 命令安装（项目官方方式）

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

构建产物：host 为 `lib/index.js`，client 为 `lib/client.js`，打包文件为 `dsh-external-ui-external-vision-0.1.0.tgz`。

## 使用

1. 打开 DSH Web。
2. 进入“设置 → 外接识图”。
3. 填写模型提供方、Base URL、模型名称和 API Key。
4. 点击“保存”。
5. 进入任意会话。
6. 直接发送图片 URL（如 `https://example.com/image.png`），插件会在当前模型不支持图片输入时自动识别并把描述注入给 AI。
7. 当 AI 调用 `read_image` 且当前模型不支持图片输入时，插件也会自动调用外部模型识别图片并把结果返回给 AI。

## 功能

- 在“设置”中新增“外接识图”配置页面。
- **URL 自动识别**：当用户消息中包含图片 URL、且当前模型不支持图片输入时，插件会自动在模型请求前下载该 URL（仅内存，不写盘），调用外部 VL 模型识别，并把识别结果作为上下文注入给 AI。
- **防盗链兼容**：下载图片时会自动携带合适的 `Referer`（iconfont/alicdn 使用 `https://www.iconfont.cn/`，其他 URL 使用同源地址），降低 CDN 403 拒绝概率。
- **失败可见**：某个 URL 获取或识别失败时，插件会把失败原因注入上下文，不再静默跳过。
- **本地图片自动调用**：当 AI 调用 `read_image` 工具、但当前模型不支持图片输入时，插件会自动调用外部 VL 模型识别图片，并把文字描述作为工具结果返回给 AI。
- `read_image` 拦截同时支持 `file_path` 与 `url` / `imageUrl` / `file_url` 参数。
- 不再提供手动“识图”视图。
- API Key 必须由用户手动输入，通过项目凭证服务保存，与“模型”设置页的实现方式一致。
- 模型提供方、Base URL、模型名称通过项目 storage domain 持久化保存，并同步到 host 内存供自动识图使用。
- 保存时会校验：模型提供方不能为空；Base URL 和模型名称不能为空；首次保存时 API Key 不能为空。已配置 API Key 后，再次保存可留空表示保持不变。

### Host API

```http
GET /@dsh-external/ui-external-vision/api/status
```

```http
GET /@dsh-external/ui-external-vision/api/config
```

```http
POST /@dsh-external/ui-external-vision/api/config
Content-Type: application/json
```

```http
POST /@dsh-external/ui-external-vision/api/vision
Content-Type: application/json
```

`/api/status` 返回默认 Base URL 和默认模型，不返回 API Key。`/api/vision` 支持 `imagePath` 或 `imageUrl`；使用 `imageUrl` 时，host 会先把远程图片下载到内存并转为 base64 data URL，再发送给外部 VL 模型。

## 原理

插件由 host 和 client 两部分组成。

Host 侧注册 `agent/pre-step` 和 `tools/execute` 两个拦截点：

- 在 `agent/pre-step` 中，插件检查即将进入模型请求的用户消息，提取图片 URL。随后通过 `llm.resolveModelInfo` 判断当前模型是否支持图片输入；如果模型不支持图片且已配置 API Key，则下载图片到内存并调用外部 VL 模型，把识别结果包装成一条 `source.kind === 'plugin'` 的用户消息注入到请求上下文。
- 在 `tools/execute` 中，当模型调用 `read_image` 且当前模型不支持图片输入时，插件会拦截该工具调用，读取本地图片或远程 URL，调用外部 VL 模型，并把文字描述作为工具结果返回给 AI。

API Key 通过项目凭证服务读取，不会出现在请求体或浏览器存储中。远程图片 URL 会在 host 内存中下载并转换为 base64 data URL 后发送到外部模型接口，不会写入磁盘。Client 侧负责渲染“外接识图”设置页，并将配置保存到 storage domain 和凭证服务。
