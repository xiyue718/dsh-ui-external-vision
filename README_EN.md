[中文](./README.md) | [English](./README_EN.md)

# @dsh-external/ui-external-vision

## Introduction

`ui-external-vision` is an external vision model plugin for the DSH Web client. When the current model does not support image input but needs to recognize an image, it calls an external VL model (default `qwen3.5-omni-plus` through an OpenAI-compatible API) to describe the image, supporting both local image paths and image URLs.

## Installation

### Method 1: Super Module Injector

```text
dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-external-vision"}
dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-external-vision"}
```

Open or refresh DSH Web and go to Settings → External Vision.

### Method 2: dsh CLI (Official Project Way)

If you have the `dsh` CLI installed, follow the official project tutorial to install with `dsh plugin`:

```bash
# Install from a local plugin directory
dsh plugin --profile web add C:/Users/<user>/.dsh/plugins/ui-external-vision

# Or install from the GitHub repository
dsh plugin --profile web add github:xiyue718/dsh-ui-external-vision
```

Start after installation:

```bash
dsh --profile web
```

View the composed configuration:

```bash
dsh --profile web --dump-config
```

See the project documentation for details: `docs/user/develop/basic/publish.md`.

Build artifacts: host `lib/index.js`, client `lib/client.js`, package `dsh-external-ui-external-vision-0.1.0.tgz`.

## Usage

1. Open DSH Web.
2. Go to Settings → External Vision.
3. Fill in the model provider, Base URL, model name, and API key.
4. Click "Save".
5. Open any session.
6. Send an image URL directly (for example `https://example.com/image.png`). When the current model does not support image input, the plugin automatically recognizes it and injects the description for the AI.
7. When the AI calls `read_image` and the current model does not support image input, the plugin automatically calls the external model and returns the result to the AI.

## Features

- Adds an "External Vision" settings page in Settings.
- **Automatic URL recognition**: when a user message contains image URLs and the current model does not support image input, the plugin downloads the URL in memory (without writing to disk), calls the external VL model, and injects the description into the request context.
- **Hotlink protection compatibility**: when downloading images, it automatically sends an appropriate `Referer` (`https://www.iconfont.cn/` for iconfont/alicdn, otherwise the URL origin), reducing CDN 403 rejections.
- **Visible failures**: if a URL cannot be fetched or recognized, the failure reason is injected into the context instead of being silently skipped.
- **Automatic local image handling**: when the AI calls `read_image` but the current model does not support image input, the plugin calls the external VL model and returns the text description as the tool result.
- `read_image` interception supports `file_path`, `url`, `imageUrl`, and `file_url` parameters.
- The manual "Vision" view is no longer provided.
- The API key must be entered manually and is saved through the project credentials service, matching the Models settings page.
- Provider, Base URL, and model name are persisted through the project storage domain and synced to host memory for automatic recognition.
- Validation on save: provider must not be empty; Base URL and model name must not be empty; API key must not be empty on first save. After the API key is configured, saving again with an empty key keeps the existing key.

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

`/api/status` returns the default Base URL and default model, never the API key. `/api/vision` accepts `imagePath` or `imageUrl`; when `imageUrl` is used, the host downloads the remote image into memory, converts it to a base64 data URL, and then sends it to the external VL model.

## How It Works

The plugin consists of a host half and a client half.

The host registers two interception points: `agent/pre-step` and `tools/execute`.

- In `agent/pre-step`, the plugin scans user messages that are about to enter the model request and extracts image URLs. It then checks whether the current model supports image input via `llm.resolveModelInfo`. If the model does not support images and an API key is configured, it downloads the images into memory, calls the external VL model, and injects the description as a user message with `source.kind === 'plugin'`.
- In `tools/execute`, when the model calls `read_image` and the current model does not support image input, the plugin intercepts the call, reads the local image or remote URL, calls the external VL model, and returns the text description as the tool result.

The API key is read from the project credentials service and never appears in request bodies or browser storage. Remote image URLs are downloaded into host memory and converted to base64 data URLs before being sent to the external model; nothing is written to disk. The client renders the External Vision settings page and saves configuration through the storage domain and credentials service.
