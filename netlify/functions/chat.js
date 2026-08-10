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

// Load .env locally if OPENCODE_API_KEY or GEMINI_API_KEY is not set in environment
if (!process.env.OPENCODE_API_KEY && !process.env.GEMINI_API_KEY) {
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

// Streamlined Base System Instruction
const BASE_SYSTEM_INSTRUCTION = `You are the DSU-SET IT Assistant, a friendly, natural-sounding helper for university staff.
Rules:
- Answer naturally and concisely.
- Only state facts provided in context. Never invent phone numbers, addresses, or grades.
- If asked about a student not in context, reply conversationally.
- Keep answers brief and to the point.`;

// Dynamic system instruction: attaches ONLY 1 student record for targeted lookups, NO records for general chat
function getDynamicSystemInstruction(message) {
  const text = (message || '').toLowerCase();
  
  // 1. Explicit request for full dataset / all students
  const isAggregateQuery = text.includes('all student') || text.includes('list student') || text.includes('full roster') || text.includes('dataset');
  if (isAggregateQuery) {
    return `${BASE_SYSTEM_INSTRUCTION}\n\nHere is the IT student roster:\n${JSON.stringify(itRoster, null, 2)}`;
  }

  // 2. Targeted query for specific student(s) -> attach ONLY matched student record(s)
  const matches = findMatchingStudents(message, itRoster);
  if (matches.length > 0) {
    return `${BASE_SYSTEM_INSTRUCTION}\n\nHere is the requested student record context:\n${JSON.stringify(matches, null, 2)}`;
  }

  // 3. General conversation / greeting -> NO student roster attached
  return BASE_SYSTEM_INSTRUCTION;
}

// Local roster matcher
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

  // 4. Exact Full Name Match
  const fullNameMatches = roster.filter(st => st.name && text.includes(st.name.toUpperCase()));
  if (fullNameMatches.length > 0) return fullNameMatches;

  // 5. Name without Initial
  const cleanNameMatches = roster.filter(st => {
    if (!st.name) return false;
    const nameWithoutInitial = st.name.replace(/\s+[A-Z]$/, '').trim().toUpperCase();
    return nameWithoutInitial.length >= 3 && text.includes(nameWithoutInitial);
  });
  if (cleanNameMatches.length > 0) return cleanNameMatches;

  // 6. Individual name parts
  const wordMatches = roster.filter(st => {
    if (!st.name) return false;
    const parts = st.name.toUpperCase().split(/\s+/);
    return parts.some(part => part.length >= 4 && text.includes(part));
  });
  if (wordMatches.length > 0) return wordMatches;

  // 7. Parent Name
  const parentMatches = roster.filter(st => {
    if (!st.parent_name || st.parent_name === "Not Available") return false;
    const parentClean = st.parent_name.replace(/\s+[A-Z]$/, '').trim().toUpperCase();
    return parentClean.length >= 4 && text.includes(parentClean);
  });
  if (parentMatches.length > 0) return parentMatches;

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

// Call OpenCode API (Primary Provider) - Fast Light Tier with 350 token cap and 12s timeout
async function callOpenCodeApi(opencodeKey, message, history, systemInstruction) {
  const messages = [
    { role: 'system', content: systemInstruction }
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
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== message) {
    messages.push({ role: 'user', content: message });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s max timeout

  try {
    const response = await fetch("https://opencode.ai/zen/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${opencodeKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash-free',
        messages: messages,
        max_tokens: 350
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    if (response.ok && data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content;
    }

    const errDetail = data.error?.message || response.statusText || response.status;
    throw new Error(`OpenCode error (${response.status}): ${errDetail}`);
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// Call Gemini API (Fallback Provider) - Fast Light Tier with 350 token cap and 6s timeout
async function callGeminiApi(geminiKey, message, history, systemInstruction) {
  const contents = [];

  if (Array.isArray(history)) {
    history.slice(-6).forEach(item => {
      if (item && item.text) {
        contents.push({
          role: item.role === 'model' || item.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: item.text }]
        });
      }
    });
  }

  const lastItem = contents[contents.length - 1];
  if (!lastItem || lastItem.role !== 'user' || lastItem.parts[0]?.text !== message) {
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });
  }

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: contents,
    generationConfig: {
      maxOutputTokens: 350
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);
    const data = await response.json();

    if (!response.ok || !data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
      const errDetail = data.error?.message || response.statusText || response.status;
      throw new Error(`Gemini API error (${response.status}): ${errDetail}`);
    }

    return data.candidates[0].content.parts[0].text;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
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

    const opencodeKey = process.env.OPENCODE_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const systemInstruction = getDynamicSystemInstruction(message);

    let reply = "";

    // Primary Provider: OpenCode API
    if (opencodeKey) {
      try {
        reply = await callOpenCodeApi(opencodeKey, message, history, systemInstruction);
      } catch (err) {
        console.warn("OpenCode API failed, switching to Gemini API fallback:", err.message);
      }
    }

    // Secondary Provider: Gemini API
    if (!reply && geminiKey) {
      try {
        reply = await callGeminiApi(geminiKey, message, history, systemInstruction);
      } catch (err) {
        console.warn("Gemini API failed:", err.message);
      }
    }

    if (reply) {
      setCachedReply(normalizedKey, reply);
      console.log(`[AI Success] Processed request in ${Date.now() - startTime}ms`);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply, responseTimeMs: Date.now() - startTime })
      };
    }

    throw new Error("All AI providers failed.");
  } catch (err) {
    console.warn("AI service call failed, attempting local record matching:", err.message);

    const matches = findMatchingStudents(message, itRoster);
    if (matches.length > 0) {
      const identifier = matches.map(st => st.register_no || st.name).join(", ");
      console.warn("Served from local dataset in", Date.now() - startTime, "ms:", identifier);
      const fallbackReply = formatMultipleProfilesLocally(matches) +
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
};
