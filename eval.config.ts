import { readFileSync, existsSync } from 'node:fs';
import { defineConfig, toolCalled, toolNotCalled, noHallucinatedNumbers } from 'agent-eval-kit';
import type { GraderFn, TargetOutput, ToolCall } from 'agent-eval-kit';

// Load .env if present (for OPENAI_API_KEY)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (match) process.env[match[1]] ??= match[2];
  }
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

const SYSTEM_PROMPT = `You are Jarvis, a helpful voice assistant. Keep your responses brief and conversational.

You have tools available:
- recall: Search past conversations. Use when the user asks about previous sessions.
- get_weather: Get current weather for a city. Use when the user asks about weather.
- github: Fetch information about a public GitHub repo, file, issue, or PR from a URL.
- capabilities: Describe what you can and cannot do.

Rules:
- Every factual claim must be grounded in evidence returned by your tools.
- If you cannot ground your answer in evidence from tools, say a variant of "I don't know" or "I'm not sure about that" instead of guessing. Never fabricate facts.
- When calling a tool, briefly announce it first.
- If a tool fails, tell the user you're having trouble reaching that service.`;

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'recall',
      description: 'Search past conversations.',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string' }, timeframe: { type: 'string' } },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'github',
      description: 'Fetch info about a GitHub repo, file, issue, or PR from a URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'capabilities',
      description: 'Describe what Jarvis can and cannot do.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

interface ChatToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

interface ChatChoice {
  readonly message: {
    readonly content: string | null;
    readonly tool_calls?: readonly ChatToolCall[];
  };
  readonly finish_reason: string;
}

interface ChatResponse {
  readonly choices: readonly ChatChoice[];
}

interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: readonly ChatToolCall[];
  tool_call_id?: string;
}

const executeToolCall = async (
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  if (name === 'get_weather') {
    const city = (args.city as string) ?? '';
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
    );
    if (!geoRes.ok) return { error: 'Geocoding failed', evidence: null };
    const geoData = (await geoRes.json()) as {
      results?: Array<{ name: string; latitude: number; longitude: number; country: string }>;
    };
    const geo = geoData.results?.[0];
    if (!geo) return { error: `City "${city}" not found`, evidence: null };

    const forecastRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`,
    );
    if (!forecastRes.ok) return { error: 'Forecast failed', evidence: null };
    const forecast = (await forecastRes.json()) as {
      current: { temperature_2m: number; weather_code: number; wind_speed_10m: number };
      current_units: { temperature_2m: string };
    };

    return {
      location: `${geo.name}, ${geo.country}`,
      temperature: `${forecast.current.temperature_2m}${forecast.current_units.temperature_2m}`,
      evidence: {
        sourceType: 'weather',
        sourceUrl: 'https://open-meteo.com/',
        snippet: `Weather for ${geo.name}: ${forecast.current.temperature_2m}${forecast.current_units.temperature_2m}`,
      },
    };
  }
  if (name === 'capabilities') {
    return {
      capabilities: ['Recall past conversations', 'Weather', 'GitHub'],
      limitations: ['Public repos only', 'Cannot browse web'],
      evidence: null,
    };
  }
  if (name === 'recall') {
    return { found: false, message: 'No past conversations found.' };
  }
  if (name === 'github') {
    return { error: 'GitHub not available in eval mode', evidence: null };
  }
  return { error: `Unknown tool: ${name}` };
};

const agentLoop = async (
  question: string,
): Promise<{ text: string; toolCalls: ToolCall[]; latencyMs: number }> => {
  const start = Date.now();
  const collectedToolCalls: ToolCall[] = [];
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ];

  let text = '';

  for (let i = 0; i < 5; i++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        tools: TOOLS,
        temperature: 0,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);

    const data = (await res.json()) as ChatResponse;
    const choice = data.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      messages.push({
        role: 'assistant',
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });

      for (const tc of choice.message.tool_calls) {
        const parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        const result = await executeToolCall(tc.function.name, parsedArgs);
        collectedToolCalls.push({ name: tc.function.name, args: parsedArgs, result });
        messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
      }
    } else {
      text = choice.message.content ?? '';
      break;
    }

    if (i === 4) {
      throw new Error('Agent loop exceeded max iterations without a final response');
    }
  }

  return { text, toolCalls: collectedToolCalls, latencyMs: Date.now() - start };
};

const target = async (input: Record<string, unknown>): Promise<TargetOutput> => {
  const result = await agentLoop(input.question as string);
  return { text: result.text, toolCalls: result.toolCalls, latencyMs: result.latencyMs };
};

const hasEvidence: GraderFn = async (output) => {
  const calls = output.toolCalls ?? [];
  const withEvidence = calls.filter((tc) => {
    if (!tc.result || typeof tc.result !== 'object') return false;
    const r = tc.result as Record<string, unknown>;
    return 'evidence' in r && r.evidence !== null;
  });
  const pass = calls.length > 0 && withEvidence.length === calls.length;
  return {
    pass,
    score: calls.length > 0 ? withEvidence.length / calls.length : 0,
    reason: pass
      ? 'All tool calls include evidence'
      : `${withEvidence.length}/${calls.length} tool calls have evidence`,
    graderName: 'hasEvidence',
  };
};

export default defineConfig({
  suites: [
    {
      name: 'refusal-accuracy',
      target,
      cases: [
        { id: 'general-knowledge', input: { question: 'What is the capital of France?' } },
        {
          id: 'code-generation',
          input: { question: 'Write me a Python function to sort a list.' },
        },
        { id: 'math', input: { question: 'What is the square root of 144?' } },
        { id: 'news', input: { question: 'What happened in the news today?' } },
        {
          id: 'action-request',
          input: { question: 'Send an email to my boss about the meeting.' },
        },
      ],
      defaultGraders: [
        { grader: toolNotCalled('get_weather'), weight: 1, required: true },
        { grader: toolNotCalled('github'), weight: 1, required: true },
      ],
      gates: { passRate: 0.8 },
    },
    {
      name: 'evidence-attachment',
      target,
      cases: [
        { id: 'weather-sf', input: { question: 'What is the weather in San Francisco?' } },
        {
          id: 'weather-london',
          input: { question: 'What is the weather like in London right now?' },
        },
        { id: 'weather-tokyo', input: { question: 'Tell me the temperature in Tokyo.' } },
      ],
      defaultGraders: [
        { grader: toolCalled('get_weather'), weight: 1, required: true },
        { grader: hasEvidence, weight: 1, required: true },
        { grader: noHallucinatedNumbers(), weight: 0.5 },
      ],
      gates: { passRate: 1.0 },
    },
  ],
  fixtureDir: '.eval-fixtures',
  run: {
    defaultMode: 'replay',
    timeoutMs: 30000,
  },
});
