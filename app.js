// DSU-SET IT Assistant Engine (Optimized & Accelerated)
(function() {
  let activeStudents = [];
  let studentMap = {}; // register_no -> student
  let debounceTimer = null;
  let conversationHistory = []; // Multi-turn conversation memory
  const clientSessionCache = new Map(); // In-session query cache

  // DOM Elements
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const messagesStream = document.getElementById('messages-stream');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const autocompleteBox = document.getElementById('autocomplete-box');
  const suggestionChips = document.querySelectorAll('.suggestion-chip');

  // Initialize App Directly into DSU-SET IT Assistant
  document.addEventListener('DOMContentLoaded', () => {
    initITAssistant();

    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportDatasetCSV);

    sendBtn.addEventListener('click', handleSendMessage);

    // Enter to send, Shift+Enter for new line
    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        hideAutocomplete();
        handleSendMessage();
      }
    });

    // Debounced search input (300ms)
    userInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(handleAutocompleteInput, 300);
    });

    // Suggestion Chips Handler
    suggestionChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const chipText = chip.innerText.trim();
        let promptText = "";

        if (chipText.includes("Register Number")) {
          promptText = "Search student with Register Number 21525100008";
        } else if (chipText.includes("Student Name")) {
          promptText = "Show profile of Aathish";
        } else if (chipText.includes("Grades")) {
          promptText = "Show grades for 21525100008";
        } else if (chipText.includes("Student Mobile")) {
          promptText = "Show Student Mobile Number for 21525100008";
        } else if (chipText.includes("Complete Student Profile")) {
          promptText = "Show complete profile of 21525100008";
        } else {
          promptText = chip.getAttribute('data-query') || chipText;
        }

        populateInputPrompt(promptText);
      });
    });

    document.addEventListener('click', (e) => {
      if (!userInput.contains(e.target) && !autocompleteBox.contains(e.target)) {
        hideAutocomplete();
      }
    });
  });

  // Populate prompt into input box and set focus
  function populateInputPrompt(text) {
    userInput.value = text;
    userInput.focus();
    const len = userInput.value.length;
    userInput.setSelectionRange(len, len);
  }

  // Direct Boot into DSU-SET IT Assistant
  function initITAssistant() {
    if (window.DSU_DEPARTMENTS_DATA && window.DSU_DEPARTMENTS_DATA['IT']) {
      activeStudents = window.DSU_DEPARTMENTS_DATA['IT'];
    } else {
      activeStudents = [];
    }

    studentMap = {};
    activeStudents.forEach(st => {
      studentMap[st.register_no] = st;
    });

    conversationHistory = [];
    messagesStream.innerHTML = '';

    appendBotMessage(`Hello! I am your **DSU-SET IT Assistant** (${activeStudents.length} IT student records loaded). How can I help you today?`);
  }

  // Autocomplete Input Handler (3+ chars)
  function handleAutocompleteInput() {
    const val = userInput.value.trim().toLowerCase();
    if (!val || val.length < 3) {
      hideAutocomplete();
      return;
    }

    const matches = activeStudents.filter(st => 
      st.register_no.toLowerCase().includes(val) ||
      st.name.toLowerCase().includes(val) ||
      (st.parent_name && st.parent_name.toLowerCase().includes(val)) ||
      (st.parent_mobile && st.parent_mobile.includes(val)) ||
      (st.student_mobile && st.student_mobile.includes(val))
    ).slice(0, 5);

    if (matches.length === 0) {
      hideAutocomplete();
      return;
    }

    autocompleteBox.innerHTML = matches.map(st => `
      <div class="autocomplete-item" data-reg="${st.register_no}">
        <strong>${st.name}</strong> &bull; Reg: ${st.register_no}
      </div>
    `).join('');

    autocompleteBox.classList.remove('hidden');

    document.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const reg = item.getAttribute('data-reg');
        populateInputPrompt(`Show complete profile of ${reg}`);
        hideAutocomplete();
      });
    });
  }

  function hideAutocomplete() {
    autocompleteBox.classList.add('hidden');
  }

  const QUERY_STOP_WORDS = new Set([
    'SHOW', 'PROFILE', 'OF', 'DETAILS', 'FOR', 'STUDENT', 'THE', 'WITH',
    'REGISTER', 'NUMBER', 'NO', 'COMPLETE', 'HI', 'HELLO', 'WHAT', 'IS',
    'CAN', 'YOU', 'SEARCH', 'PARENT', 'GET', 'DATA', 'RECORD', 'INFORMATION'
  ]);

  // Client-side fallback student finder when AI service or backend fails
  function findMatchingStudentsLocally(userMessage, roster) {
    if (!userMessage || !roster || !Array.isArray(roster) || roster.length === 0) return [];
    const text = userMessage.trim().toUpperCase();

    // 1. Check Register Numbers
    const regMatches = roster.filter(st => st.register_no && text.includes(st.register_no.toUpperCase()));
    if (regMatches.length > 0) return regMatches;

    // 2. Check Admission Numbers
    const admMatches = roster.filter(st => st.admission_no && text.includes(st.admission_no.toUpperCase()));
    if (admMatches.length > 0) return admMatches;

    // 3. Check Phone Numbers
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

  function isBareRegisterNumberQuery(text) {
    const trimmed = (text || '').trim().replace(/[\.\?\,\:]+$/, '');
    return /^(show\s+complete\s+profile\s+of|show\s+profile\s+of|show\s+profile|show|register\s*(no\.?)?|reg\s*(no\.?)?)?\s*:?\s*\d{11}\s*$/i.test(trimmed);
  }

  function extractRegisterNumber(text) {
    const match = text.match(/\d{11}/);
    return match ? match[0] : null;
  }

  function formatProfileLocally(student) {
    return `**${student.name}** (Reg. No: ${student.register_no})
Admission No: ${student.admission_no || 'N/A'}
Department: ${student.department || 'IT'}
Student Mobile: ${student.student_mobile || 'Not Available'}
Parent Name: ${student.parent_name || 'Not Available'}
Parent Mobile: ${student.parent_mobile || 'Not Available'}
Address: ${student.address || 'Not Available'}
Pincode: ${student.pincode || 'N/A'}`;
  }

  function formatMultipleProfilesLocally(students) {
    return students.map(st => formatProfileLocally(st)).join("\n\n---\n\n");
  }

  // Netlify Functions Chat Backend Caller with Client-Side Cache
  async function askAI(prompt, history) {
    const cacheKey = prompt.trim().toLowerCase();
    if (clientSessionCache.has(cacheKey)) {
      console.log("[Client Cache Hit] Returning instant response for:", cacheKey);
      return clientSessionCache.get(cacheKey);
    }

    try {
      const response = await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, history: history })
      });
      const data = await response.json();
      if (!response.ok || !data.reply) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      
      clientSessionCache.set(cacheKey, data.reply);
      return data.reply;
    } catch (err) {
      console.warn("AI service/backend unavailable:", err.message);

      const matches = findMatchingStudentsLocally(prompt, activeStudents);
      if (matches.length > 0) {
        const identifier = matches.map(st => st.register_no || st.name).join(", ");
        console.warn("AI unavailable, served from local data:", identifier);
        return formatMultipleProfilesLocally(matches) +
          "\n\n_(AI service is currently unavailable — showing local record data instead.)_";
      }

      return "Sorry, I'm having trouble reaching the AI service right now, and I couldn't find a matching student in the local records either.";
    }
  }

  // Handle User Message Submission (Immediate visual feedback)
  async function handleSendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    appendUserMessage(text);
    userInput.value = '';
    userInput.focus();

    // Check if it's a bare register number query -> Handle INSTANTLY client-side without AI call
    if (isBareRegisterNumberQuery(text)) {
      const regNo = extractRegisterNumber(text);
      const student = activeStudents.find(s => s.register_no === regNo);
      let replyText = "";
      if (student) {
        replyText = formatProfileLocally(student);
      } else {
        replyText = `I couldn't find a student with register number ${regNo}.`;
      }

      conversationHistory.push({ role: 'user', text: text });
      conversationHistory.push({ role: 'model', text: replyText });
      if (conversationHistory.length > 8) {
        conversationHistory = conversationHistory.slice(-8);
      }

      appendBotMessage(replyText, 'instant_local');
      return;
    }

    // Push user message into conversation history
    conversationHistory.push({ role: 'user', text: text });
    if (conversationHistory.length > 8) {
      conversationHistory = conversationHistory.slice(-8);
    }

    // Show 3-dot typing indicator IMMEDIATELY upon sending
    const typingIndicator = createTypingIndicator();
    messagesStream.appendChild(typingIndicator);
    scrollToBottomSmooth();

    try {
      const reply = await askAI(text, conversationHistory);
      typingIndicator.remove();

      // Push bot response into conversation history
      conversationHistory.push({ role: 'model', text: reply });
      if (conversationHistory.length > 8) {
        conversationHistory = conversationHistory.slice(-8);
      }

      appendBotMessage(reply, 'ai');
    } catch (err) {
      console.warn("Unexpected error sending message:", err);
      typingIndicator.remove();

      const matches = findMatchingStudentsLocally(text, activeStudents);
      if (matches.length > 0) {
        appendBotMessage(formatMultipleProfilesLocally(matches) +
          "\n\n_(AI service is currently unavailable — showing local record data instead.)_", 'fallback_local');
      } else {
        appendBotMessage("Sorry, I'm having trouble reaching the AI service right now, and I couldn't find a matching student in the local records either.", 'fallback_local');
      }
    }
  }

  function exportDatasetCSV() {
    if (!activeStudents || activeStudents.length === 0) return;

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += `"S.No","Register Number","Student Name","Branch","Parent Name","Address","Student Mobile","Parent Mobile"\n`;

    activeStudents.forEach(st => {
      csvContent += `"${st.s_no}","${st.register_no}","${st.name}","IT-A","${st.parent_name || 'Not Available'}","${st.address || 'Not Available'}","${st.student_mobile || 'Not Available'}","${st.parent_mobile || 'Not Available'}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `DSU_SET_IT_students_dataset.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // User Message (Right Aligned)
  function appendUserMessage(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper user';
    wrapper.innerHTML = `
      <div class="message-label user">You</div>
      <div class="message-bubble user">${escapeHtml(text)}</div>
    `;
    messagesStream.appendChild(wrapper);
    scrollToBottomSmooth();
  }

  // Assistant Message (Left Aligned - AI badge, Instant Local badge, or Local Record badge when offline)
  function appendBotMessage(markdownText, tagType = 'ai') {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper bot';

    const formattedText = simpleMarkdownParse(markdownText);
    let badge = '';
    if (tagType === 'instant_local') {
      badge = `<span class="ai-badge instant-local" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);" title="Instant deterministic lookup from local dataset">⚡ Local Data — Instant</span>`;
    } else if (tagType === 'fallback_local' || (markdownText && (markdownText.includes("showing local record data instead") || markdownText.includes("AI service is currently unavailable")))) {
      badge = `<span class="ai-badge offline" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border-color: rgba(234, 179, 8, 0.3);" title="Served from local dataset">📁 Local Record</span>`;
    } else {
      badge = `<span class="ai-badge" title="Response generated by AI Assistant">✨ AI-assisted</span>`;
    }

    const escapedMarkdown = markdownText ? markdownText.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$') : '';

    wrapper.innerHTML = `
      <div class="message-label bot"><span>DSU-SET IT Assistant</span> ${badge}</div>
      <div class="bot-text-bubble">${formattedText}</div>
      ${markdownText ? `<button class="copy-btn" onclick="navigator.clipboard.writeText(\`${escapedMarkdown}\`)" title="Copy text">Copy</button>` : ''}
    `;
    messagesStream.appendChild(wrapper);
    scrollToBottomSmooth();
  }

  // Typing Indicator
  function createTypingIndicator() {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper bot';
    wrapper.innerHTML = `
      <div class="message-label bot"><span>DSU-SET IT Assistant</span> ✨</div>
      <div class="bot-text-bubble" style="font-style: italic; color: #8b5cf6; display: flex; align-items: center; gap: 8px;">
        <span>✨ DSU-SET IT Assistant is thinking...</span>
        <div class="typing-dots">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      </div>
    `;
    return wrapper;
  }

  function scrollToBottomSmooth() {
    setTimeout(() => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
      messagesStream.scrollTo({
        top: messagesStream.scrollHeight,
        behavior: 'smooth'
      });
    }, 60);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function simpleMarkdownParse(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^[\*\-] (.*?)$/gm, '<li style="margin-left: 14px;">$1</li>')
      .replace(/\n/g, '<br>');
  }
})();
