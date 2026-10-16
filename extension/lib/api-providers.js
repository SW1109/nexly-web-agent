// 预设只填写官方公开的兼容地址，不预置密钥、不锁定模型或套餐；仍可自由编辑。
export const API_PROVIDERS = Object.freeze([
  { id: 'custom', name: '自定义 / 中转站', baseUrl: '', hint: '填写服务商提供的 OpenAI 兼容地址与模型 ID。' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/chat/completions', docs: 'https://api-docs.deepseek.com/', hint: '使用 DeepSeek 开放平台的 API Key；模型可获取或手填。' },
  { id: 'qwen', name: '通义千问 · 阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', docs: 'https://help.aliyun.com/en/model-studio/base-url', hint: '预设为中国北京通用接口。地域、工作空间与 Coding Plan 地址/Key 必须配套，可手动修改。' },
  { id: 'glm', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', docs: 'https://docs.bigmodel.cn/cn/api/introduction', hint: '预设为通用 API，不是 Coding Plan 专属地址；请核对套餐。' },
  { id: 'kimi', name: 'Kimi · 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', docs: 'https://platform.moonshot.cn/docs/guide/start-using-kimi-api', hint: '预设为中国区开放平台；Kimi CLI/会员凭证不等于通用 API Key。' },
  { id: 'doubao', name: '豆包 · 火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', docs: 'https://www.volcengine.com/docs/82379/1399008', hint: '模型填写控制台允许的模型 ID 或推理接入点 ID（ep-…）；未提供模型列表时请手填。' },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.cn/v1', docs: 'https://platform.minimax.cn/docs/api-reference/text-openai-api', hint: '使用通用 OpenAI 兼容接口。中国区与国际区、Coding Plan 的地址/凭证不同，请按控制台核对。' },
  { id: 'tokenhub', name: '腾讯 TokenHub · 混元与多模型', baseUrl: 'https://tokenhub.tencentmaas.com/v1', docs: 'https://cloud.tencent.com/document/product/1772/115970', hint: '使用 TokenHub 控制台签发的 API Key，与旧版混元接口密钥不通用。' },
  { id: 'hunyuan', name: '腾讯混元 · 旧版兼容接口', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', docs: 'https://cloud.tencent.com/document/product/1729/111007', hint: '使用混元 OpenAI 兼容接口专用 API Key，不是腾讯云 SecretId / SecretKey。' },
  { id: 'qianfan', name: '百度千帆 · 文心', baseUrl: 'https://qianfan.baidubce.com/v2', docs: 'https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb', hint: '使用千帆 API Key，不是旧版 AK/SK 或 access_token；模型以控制台为准。' },
  { id: 'spark', name: '讯飞星火', baseUrl: 'https://spark-api-open.xf-yun.com/v1', docs: 'https://www.xfyun.cn/doc/spark/Web.html', hint: '使用 HTTP 接口的 APIPassword，不是 WebSocket 的 APIKey/APISecret。模型以官方服务为准。' },
  { id: 'siliconflow', name: '硅基流动 · 多款国产模型', baseUrl: 'https://api.siliconflow.cn/v1', docs: 'https://docs.siliconflow.cn/docs/api/chat-completions-post', hint: '平台聚合模型可使用带组织前缀的完整模型 ID；不同模型的权限、费用由平台决定。' },
  { id: 'stepfun', name: '阶跃星辰', baseUrl: 'https://api.stepfun.com/v1', docs: 'https://platform.stepfun.com/docs/zh/welcome', hint: '使用阶跃星辰开放平台 API Key，模型可获取或手填。' }
]);
export function apiProvider(id) { return API_PROVIDERS.find((provider) => provider.id === id) || API_PROVIDERS[0]; }
