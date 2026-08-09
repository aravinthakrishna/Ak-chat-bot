// DSU-SET IT Assistant Engine (Fully Gemini-Driven)
(function() {
  let activeStudents = [];
  let studentMap = {}; // register_no -> student
  let debounceTimer = null;
  let conversationHistory = []; // Multi-turn conversation memory

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

  // Client-side fallback student finder when Gemini API or backend fails
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

    // 6. Individual name parts (words >= 4 chars)
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

  // Netlify Functions Chat Backend Caller (All messages go through Gemini)
  async function askGemini(prompt, history) {
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
      return data.reply;
    } catch (err) {
      console.warn("Gemini service/backend unavailable:", err.message);

      const matches = findMatchingStudentsLocally(prompt, activeStudents);
      if (matches.length > 0) {
        const identifier = matches.map(st => st.register_no || st.name).join(", ");
        console.warn("Gemini unavailable, served from local data:", identifier);
        return formatMultipleProfilesLocally(matches) +
          "\n\n_(AI service is currently unavailable — showing local record data instead.)_";
      }

      return "Sorry, I'm having trouble reaching the AI service right now, and I couldn't find a matching student in the local records either.";
    }
  }

  // Handle User Message Submission
  async function handleSendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    appendUserMessage(text);
    userInput.value = '';
    userInput.focus();

    // Push user message into conversation history
    conversationHistory.push({ role: 'user', text: text });
    if (conversationHistory.length > 8) {
      conversationHistory = conversationHistory.slice(-8);
    }

    // Show 3-dot typing indicator and scroll smoothly
    const typingIndicator = createTypingIndicator();
    messagesStream.appendChild(typingIndicator);
    scrollToBottomSmooth();

    try {
      const reply = await askGemini(text, conversationHistory);
      typingIndicator.remove();

      // Push bot response into conversation history
      conversationHistory.push({ role: 'model', text: reply });
      if (conversationHistory.length > 8) {
        conversationHistory = conversationHistory.slice(-8);
      }

      appendBotMessage(reply);
    } catch (err) {
      console.warn("Unexpected error sending message:", err);
      typingIndicator.remove();

      const matches = findMatchingStudentsLocally(text, activeStudents);
      if (matches.length > 0) {
        const identifier = matches.map(st => st.register_no || st.name).join(", ");
        console.warn("Gemini unavailable, served from local data:", identifier);
        appendBotMessage(formatMultipleProfilesLocally(matches) +
          "\n\n_(AI service is currently unavailable — showing local record data instead.)_");
      } else {
        appendBotMessage("Sorry, I'm having trouble reaching the AI service right now, and I couldn't find a matching student in the local records either.");
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

  // Assistant Message (Left Aligned - AI badge or Local Record badge when offline)
  function appendBotMessage(markdownText) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper bot';

    const formattedText = simpleMarkdownParse(markdownText);
    const isFallback = markdownText && (markdownText.includes("showing local record data instead") || markdownText.includes("AI service is currently unavailable"));
    const badge = isFallback
      ? `<span class="ai-badge offline" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border-color: rgba(234, 179, 8, 0.3);" title="Served from local dataset">📁 Local Record</span>`
      : `<span class="ai-badge" title="Response generated by Gemini AI">✨ AI-assisted</span>`;

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
