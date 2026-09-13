// Turns a technician's shorthand into a customer-facing summary.
const { OpenAI } = require('openai');
const config = require('./config');

const SYSTEM_PROMPT =
  'You are an assistant for a home services company. Turn the technician\'s raw shorthand notes into a ' +
  'professional, polite, and clear customer-facing service summary (1-2 paragraphs). Maintain all technical ' +
  'details but explain them simply. Do not invent work that is not in the notes.';

let client;
function getClient() {
  if (!config.openaiApiKey) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.status = 503;
    err.expose = true;
    throw err;
  }
  if (!client) client = new OpenAI({ apiKey: config.openaiApiKey, timeout: 30_000, maxRetries: 1 });
  return client;
}

async function summarizeNotes(rawNotes) {
  const completion = await getClient().chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: rawNotes },
    ],
  });
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Summarizer returned an empty response');
  return text;
}

module.exports = { summarizeNotes };
