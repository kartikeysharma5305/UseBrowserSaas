import OpenAI from 'openai';

import {
  NVIDIA_NIM_MODEL_ALIASES,
  type NvidiaNimModelAlias,
} from '../src/llm/nvidia/models.js';
import { NVIDIA_NIM_BASE_URL } from '../src/llm/nvidia/chat.js';

const key = process.env.NVIDIA_API_KEY?.trim();
if (!key) {
  console.error(
    JSON.stringify({ provider: 'nvidia', status: 'NOT_CONFIGURED' })
  );
  process.exit(2);
}

const requested =
  process.argv.find((value) => value.startsWith('--model='))?.slice(8) ??
  process.env.NVIDIA_NIM_TEST_MODEL?.trim();
const all = process.argv.includes('--all');
const aliases = all
  ? (Object.keys(NVIDIA_NIM_MODEL_ALIASES) as NvidiaNimModelAlias[])
  : ([requested || 'nemotron-3-ultra-550b-a55b'] as string[]);

const client = new OpenAI({
  apiKey: key,
  baseURL: NVIDIA_NIM_BASE_URL,
  timeout: 45_000,
  maxRetries: 1,
});

function category(error: unknown) {
  const status = Number((error as { status?: unknown })?.status ?? NaN);
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 404) return 'MODEL_UNAVAILABLE';
  if (status >= 500) return 'TEMPORARILY_UNAVAILABLE';
  if (/timeout|abort/i.test(error instanceof Error ? error.message : ''))
    return 'TIMEOUT';
  return 'INCOMPATIBLE';
}

function errorMetadata(error: unknown) {
  const candidate = error as { status?: unknown; code?: unknown };
  return {
    ...(Number.isInteger(candidate?.status)
      ? { httpStatus: Number(candidate.status) }
      : {}),
    ...(typeof candidate?.code === 'string' &&
    /^[A-Z0-9_.-]{1,80}$/i.test(candidate.code)
      ? { providerCode: candidate.code }
      : {}),
  };
}

for (const alias of aliases) {
  const providerModel = NVIDIA_NIM_MODEL_ALIASES[alias as NvidiaNimModelAlias];
  if (!providerModel) {
    console.log(
      JSON.stringify({
        provider: 'nvidia',
        model: alias,
        status: 'NOT_CANDIDATE',
      })
    );
    continue;
  }
  const startedAt = Date.now();
  let stage = 'basic_chat';
  const modelParameters = providerModel.includes('nemotron-3-ultra')
    ? { chat_template_kwargs: { enable_thinking: false } }
    : {};
  try {
    const basic = await client.chat.completions.create({
      model: providerModel,
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
      max_tokens: 64,
      temperature: 0.2,
      ...modelParameters,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    if (!basic.choices[0]?.message) throw new Error('Malformed chat response.');

    stage = 'tool_call';
    const tool = await client.chat.completions.create({
      model: providerModel,
      messages: [
        { role: 'user', content: 'Report the page title Example Domain.' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'report_title',
            description: 'Report a browser page title.',
            parameters: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'report_title' } },
      max_tokens: 512,
      temperature: 0.2,
      ...modelParameters,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    const call = tool.choices[0]?.message.tool_calls?.[0];
    if (!call || call.type !== 'function') throw new Error('No tool call.');
    const args = JSON.parse(call.function.arguments) as { title?: unknown };
    if (args.title !== 'Example Domain')
      throw new Error('Invalid tool arguments.');

    stage = 'tool_result';
    const sequential = await client.chat.completions.create({
      model: providerModel,
      messages: [
        { role: 'user', content: 'Report the page title Example Domain.' },
        tool.choices[0].message,
        {
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ accepted: true }),
        },
      ],
      max_tokens: 128,
      temperature: 0.2,
      ...modelParameters,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    if (!sequential.choices[0]?.message) throw new Error('No final response.');

    console.log(
      JSON.stringify({
        provider: 'nvidia',
        model: alias,
        status: 'SUPPORTED',
        latencyMs: Date.now() - startedAt,
        usageReported: Boolean(basic.usage || tool.usage || sequential.usage),
      })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        provider: 'nvidia',
        model: alias,
        status: category(error),
        stage,
        ...errorMetadata(error),
        latencyMs: Date.now() - startedAt,
      })
    );
  }
}
