export const CAPABILITIES_TOOL_DEF = {
  type: 'function' as const,
  name: 'capabilities',
  description:
    'Describe what Jarvis can and cannot do. Use when the user asks what you can help with, what your abilities are, or what tools you have.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const handleCapabilities = async (): Promise<Record<string, unknown>> => ({
  capabilities: [
    'Recall past conversations — I can search my memory of our previous sessions by topic, date, or keyword.',
    'Weather — I can get current weather conditions for any city worldwide.',
    'GitHub — I can read and summarize public GitHub repositories, files, issues, and pull requests from a URL you provide.',
  ],
  limitations: [
    'I can only access public GitHub repositories.',
    "I cannot browse the web or access URLs that aren't GitHub links.",
    'I cannot create, modify, or delete anything on GitHub — read-only access.',
    'I cannot set reminders, send emails, or interact with other services.',
    "If I don't have evidence from my tools to answer a question, I'll say \"I don't know\" rather than guess.",
  ],
  evidence: null,
});
