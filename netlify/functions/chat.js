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

// Helper to match student from roster when Gemini API is unavailable
function findMatchingStudents(userMessage, roster) {
  if (!userMessage || !roster || !Array.isArray(roster) || roster.length === 0) return [];
  const text = userMessage.trim().toUpperCase();

  // 1. Check Register Numbers (e.g. 11 digits or st.register_no)
  const regMatches = roster.filter(st => st.register_no && text.includes(st.register_no.toUpperCase()));
  if (regMatches.length > 0) return regMatches;

  // 2. Check Admission Numbers
  const admMatches = roster.filter(st => st.admission_no && text.includes(st.admission_no.toUpperCase()));
  if (admMatches.length > 0) return admMatches;

  // 3. Check Phone Numbers (student_mobile or parent_mobile)
  const phoneMatches = roster.filter(st => 
    (st.student_mobile && st.student_mobile !== "Not Available" && text.includes(st.student_mobile)) ||
    (st.parent_mobile && st.parent_mobile !== "Not Available" && text.includes(st.parent_mobile))
  );
  if (phoneMatches.length > 0) return phoneMatches;

  // 4. Exact Full Name Match (e.g. "ARAVINTHAKRISHNA S")
  const fullNameMatches = roster.filter(st => st.name && text.includes(st.name.toUpperCase()));
  if (fullNameMatches.length > 0) return fullNameMatches;

  // 5. Name without Initial (e.g., "AATHISH S" -> "AATHISH", "ABDUL HADHI S" -> "ABDUL HADHI")
  const cleanNameMatches = roster.filter(st => {
    if (!st.name) return false;
    const nameWithoutInitial = st.name.replace(/\s+[A-Z]$/, '').trim().toUpperCase();
    return nameWithoutInitial.length >= 3 && text.includes(nameWithoutInitial);
  });
  if (cleanNameMatches.length > 0) return cleanNameMatches;

  // 6. Individual name parts (words >= 4 chars, e.g. "ARAVINTHAKRISHNA", "AATHISH")
  const wordMatches = roster.filter(st => {
    if (!st.name) return false;
    const parts = st.name.toUpperCase().split(/\s+/);
    return parts.some(part => part.length >= 4 && text.includes(part));
  });
  if (wordMatches.length > 0) return wordMatches;

  // 7. Check Parent Name
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

exports.handler = async function (event) {
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
      throw new Error("GEMINI_API_KEY environment variable is not configured.");
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
      const errDetail = data.error?.message || response.statusText || response.status;
      throw new Error(`Gemini API error (Status ${response.status}): ${errDetail}`);
    }

    const reply = data.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    console.warn("Gemini API call failed:", err.message);

    const matches = findMatchingStudents(message, itRoster);
    if (matches.length > 0) {
      const identifier = matches.map(st => st.register_no || st.name).join(", ");
      console.warn("Gemini unavailable, served from local data:", identifier);
      const fallbackReply = formatMultipleProfilesLocally(matches) +
        "\n\n_(AI service is currently unavailable — showing local record data instead.)_";
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: fallbackReply, fallback: true })
      };
    }

    console.warn("Gemini unavailable and no matching student found in local records for message:", message);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply: "Sorry, I'm having trouble reaching the AI service right now, and I couldn't find a matching student in the local records either.",
        fallback: false
      })
    };
  }
};

