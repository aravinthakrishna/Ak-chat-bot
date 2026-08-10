const fs = require('fs');
const path = require('path');
const itRoster = require('../../data/it.json');

// Server-side response cache (In-memory LRU cache)
const responseCache = new Map();
const MAX_CACHE_SIZE = 100;

function getCachedReply(key) {
  return responseCache.get(key);
}

function setCachedReply(key, reply) {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const firstKey = responseCache.keys().next().value;
    responseCache.delete(firstKey);
  }
  responseCache.set(key, reply);
}

// Load .env locally if OPENCODE_ZEN_API_KEY or OPENCODE_API_KEY is not set in environment
if (!process.env.OPENCODE_ZEN_API_KEY && !process.env.OPENCODE_API_KEY) {
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

// Query stop words to prevent false token matches
const QUERY_STOP_WORDS = new Set([
  'SHOW', 'PROFILE', 'OF', 'DETAILS', 'FOR', 'STUDENT', 'THE', 'WITH',
  'REGISTER', 'NUMBER', 'NO', 'COMPLETE', 'HI', 'HELLO', 'WHAT', 'IS',
  'CAN', 'YOU', 'SEARCH', 'PARENT', 'GET', 'DATA', 'RECORD', 'INFORMATION'
]);

// Local roster matcher — returns matched student(s) or empty array [] if no match
function findMatchingStudents(userMessage, roster) {
  if (!userMessage || !roster || !Array.isArray(roster) || roster.length === 0) return [];
  const text = userMessage.trim().toUpperCase();

  // 1. Register Numbers
  const regMatches = roster.filter(st => st.register_no && text.includes(st.register_no.toUpperCase()));
  if (regMatches.length > 0) return regMatches;

  // 2. Admission Numbers
  const admMatches = roster.filter(st => st.admission_no && text.includes(st.admission_no.toUpperCase()));
  if (admMatches.length > 0) return admMatches;

  // 3. Phone Numbers
  const phoneMatches = roster.filter(st => 
    (st.student_mobile && st.student_mobile !== "Not Available" && text.includes(st.student_mobile)) ||
    (st.parent_mobile && st.parent_mobile !== "Not Available" && text.includes(st.parent_mobile))
  );
  if (phoneMatches.length > 0) return phoneMatches;

  // 4. Exact Full Name Match (or student name inside userMessage)
  const fullNameMatches = roster.filter(st => st.name && text.includes(st.name.toUpperCase()));
  if (fullNameMatches.length > 0) return fullNameMatches;

  // 5. Query word tokens matching student name or parent name
  const words = text.split(/[^A-Z0-9]+/).filter(w => w.length >= 3 && !QUERY_STOP_WORDS.has(w));
  if (words.length > 0) {
    const tokenMatches = roster.filter(st => {
      const stName = (st.name || '').toUpperCase();
      const stParent = (st.parent_name || '').toUpperCase();
      return words.some(w => stName.includes(w) || (stParent !== 'NOT AVAILABLE' && stParent.includes(w)));
    });
    if (tokenMatches.length > 0) return tokenMatches;
  }

  return [];
}

function formatProfileLocally(st) {
  return `**Student Record:**
- **Name:** ${st.name}
- **Register No:** ${st.register_no}
- **Admission No:** ${st.admission_no || 'N/A'}
- **Department:** ${st.department || 'IT'}
- **Student Mobile:** ${st.student_mobile || 'Not Available'}
- **Parent Name:** ${st.parent_name || 'Not Available'}
- **Parent Mobile:** ${st.parent_mobile || 'Not Available'}
- **Address:** ${st.address || 'Not Available'}
- **Pincode:** ${st.pincode || 'N/A'}`;
}

function formatMultipleProfilesLocally(students) {
  return students.map(st => formatProfileLocally(st)).join("\n\n---\n\n");
}

// Call OpenCode Zen OpenAI-compatible API
async function askOpenCodeZen(prompt, studentContext, history) {
  const apiKey = process.env.OPENCODE_ZEN_API_KEY || process.env.OPENCODE_API_KEY;
  if (!apiKey) {
    throw new Error("OPENCODE_ZEN_API_KEY is missing from environment");
  }

  const systemContent = `You are the DSU-SET IT Assistant, a friendly, natural-sounding helper for university staff.
${studentContext ? `Here is the relevant student record as JSON: ${JSON.stringify(studentContext)}` : "No specific student record is relevant to this message."}
Rules:
- Answer naturally, like a helpful colleague — no robotic templated phrases.
- Only state facts present in the provided JSON. Never invent a phone number, address, or grade.
- If asked about a student not provided in context, say so conversationally.
- If someone greets you or makes general conversation, respond naturally and briefly.`;

  const messages = [
    { role: "system", content: systemContent }
  ];

  if (Array.isArray(history)) {
    history.slice(-6).forEach(item => {
      if (item && item.text) {
        messages.push({
          role: item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user',
          content: item.text
        });
      }
    });
  }

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== prompt) {
    messages.push({ role: "user", content: prompt });
  }

  const model = process.env.OPENCODE_MODEL || "laguna-s-2.1-free";

  const response = await fetch("https://opencode.ai/zen/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: 400
    })
  });

  const data = await response.json();
  if (!response.ok || !data.choices || !data.choices[0]?.message?.content) {
    console.error("OpenCode Zen API failed:", response.status, JSON.stringify(data));
    throw new Error(`OpenCode Zen API error (${response.status})`);
  }

  return data.choices[0].message.content;
}

function isBareRegisterNumberQuery(text) {
  const trimmed = (text || '').trim().replace(/[\.\?\,\:]+$/, '');
  return /^(show\s+complete\s+profile\s+of|show\s+profile\s+of|show\s+profile|show|register\s*(no\.?)?|reg\s*(no\.?)?)?\s*:?\s*\d{11}\s*$/i.test(trimmed);
}

function extractRegisterNumber(text) {
  const match = text.match(/\d{11}/);
  return match ? match[0] : null;
}

exports.handler = async function (event) {
  const startTime = Date.now();
  let message = "";
  try {
    const parsedBody = JSON.parse(event.body || '{}');
    message = parsedBody.message || "";
    const history = parsedBody.history;

    if (!message) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Message is required." })
      };
    }

    // Check if it's a bare register number query -> Skip AI entirely and serve instantly from local dataset
    if (isBareRegisterNumberQuery(message)) {
      const regNo = extractRegisterNumber(message);
      const student = itRoster.find(s => s.register_no === regNo);
      let replyText = "";
      if (student) {
        replyText = formatProfileLocally(student);
      } else {
        replyText = `I couldn't find a student with register number ${regNo}.`;
      }
      console.log(`[Instant Local Lookup] Handled bare reg query ${regNo} in ${Date.now() - startTime}ms`);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: replyText, source: "instant_local", isInstantLocal: true, responseTimeMs: Date.now() - startTime })
      };
    }

    // Check In-Memory Cache
    const normalizedKey = message.trim().toLowerCase();
    const cached = getCachedReply(normalizedKey);
    if (cached) {
      console.log(`[Cache Hit] Served response in ${Date.now() - startTime}ms`);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: cached, cached: true, responseTimeMs: Date.now() - startTime })
      };
    }

    const matches = findMatchingStudents(message, itRoster);
    const matchedStudent = matches.length === 1 ? matches[0] : (matches.length > 1 ? matches : null);

    try {
      const reply = await askOpenCodeZen(message, matchedStudent, history);
      setCachedReply(normalizedKey, reply);
      console.log(`[OpenCode Zen Success] Processed request in ${Date.now() - startTime}ms`);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply, responseTimeMs: Date.now() - startTime })
      };
    } catch (err) {
      console.warn("OpenCode Zen unavailable, serving local data instead:", err.message);

      if (matchedStudent) {
        const localFormatted = Array.isArray(matchedStudent)
          ? formatMultipleProfilesLocally(matchedStudent)
          : formatProfileLocally(matchedStudent);
        const fallbackReply = localFormatted +
          "\n\n_(AI service is currently unavailable — showing local record data instead.)_";
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: fallbackReply, fallback: true, responseTimeMs: Date.now() - startTime })
        };
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reply: "Sorry, I'm having trouble reaching the AI service right now, and I couldn't find a matching student in the local records either.",
          fallback: false,
          responseTimeMs: Date.now() - startTime
        })
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
