const fs = require('fs');
const path = require('path');
const itRoster = require('../../data/it.json');

// Load .env locally if GEMINI_API_KEY is not set in environment
if (!process.env.GEMINI_API_KEY) {
  try {
    const envPath = path.resolve(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
          if (key) process.env[key] = val;
        }
      });
    }
  } catch (e) {
    console.warn("Could not load local .env file:", e.message);
  }
}

const SYSTEM_INSTRUCTION = `You are the DSU-SET IT Assistant, a friendly, natural-sounding helper for university staff.
You have access to the IT department's student roster, provided below as JSON. Each record has:
register_no, name, department, student_mobile, parent_mobile, address, and semester results.

Rules:
- Answer naturally, like a helpful colleague — do not use robotic templated phrases or emoji-prefixed error codes.
- Only state facts that are actually present in the provided JSON. Never invent a phone number, address, or grade.
- If someone asks about a student who isn't in the JSON, say so conversationally (e.g. "I don't see anyone by that name in the IT roster — could you double check the spelling or give me their register number?") rather than a fixed error string.
- If someone greets you, asks what you can do, or makes general conversation, respond naturally and briefly — you don't need the roster for that.
- If a name matches more than one student, ask which one they mean.
- Keep answers concise and to the point unless asked for more detail.

Here is the current IT student roster:
${JSON.stringify(itRoster, null, 2)}`;

exports.handler = async function (event) {
  try {
    const { message, history } = JSON.parse(event.body || '{}');

    if (!message) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Message is required." })
      };
    }

    const contents = [];

    // Format conversation history if provided (last 8 messages)
    if (Array.isArray(history)) {
      history.slice(-8).forEach(item => {
        if (item && item.text) {
          contents.push({
            role: item.role === 'model' || item.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: item.text }]
          });
        }
      });
    }

    // Append latest user message if not already the last item in contents
    const lastItem = contents[contents.length - 1];
    if (!lastItem || lastItem.role !== 'user' || lastItem.parts[0]?.text !== message) {
      contents.push({
        role: 'user',
        parts: [{ text: message }]
      });
    }

    const payload = {
      system_instruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents: contents
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY environment variable is missing.");
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "GEMINI_API_KEY environment variable is not configured." })
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    if (!response.ok || !data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
      console.error("Gemini API error:", response.status, JSON.stringify(data));
      return {
        statusCode: response.status || 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Gemini API failed", status: response.status, details: data })
      };
    }

    const reply = data.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
