import { ChatOpenAI, type ChatOpenAIOptions } from '../openai/chat.js';

export const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export interface ChatNvidiaOptions extends Omit<
  ChatOpenAIOptions,
  'baseURL' | 'apiKey'
> {
  model: string;
  apiKey?: string;
}

/** OpenAI-compatible NVIDIA hosted NIM chat client with a fixed endpoint. */
export class ChatNvidia extends ChatOpenAI {
  public override provider = 'nvidia';

  constructor(options: ChatNvidiaOptions) {
    super({
      ...options,
      apiKey: options.apiKey,
      baseURL: NVIDIA_NIM_BASE_URL,
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
      temperature: options.temperature ?? 0.2,
      frequencyPenalty: null,
      completionTokenParameter: 'max_tokens',
      // NIM model support for OpenAI response_format varies. Browser-Use already
      // supplies a schema, so prompt it and parse the bounded JSON response.
      addSchemaToSystemPrompt: true,
      dontForceStructuredOutput: true,
      extraBody: options.model.includes('nemotron-3-ultra')
        ? { chat_template_kwargs: { enable_thinking: false } }
        : null,
    });
  }
}
