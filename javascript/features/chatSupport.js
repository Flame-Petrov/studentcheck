import { authHeaders } from '../api/authFetch.js';
import { SERVER_BASE_URL } from '../config/api.js';

/**
 * Support chat — the "Чат" view of the teacher page (#chat). The markup is the
 * static #chatSection in teacherHomepage.html; this only binds behaviour.
 *
 * The input is never focused from script: on phones that would open the
 * on-screen keyboard as soon as the view is shown. It gets focus only when the
 * user taps it, and while a reply is pending it is made read-only (not
 * disabled), so a keyboard the user opened stays open instead of closing.
 */

/** Called by the view router when the chat view is shown. */
export function showSupportChat() {
    const historyContainer = document.getElementById('chatHistoryContainer');
    if (historyContainer) historyContainer.scrollTop = historyContainer.scrollHeight;
}

export function initSupportChat() {
    const sendBtn = document.getElementById('sendChatBtn');
    const input = document.getElementById('chatInput');
    const historyContainer = document.getElementById('chatHistoryContainer');
    if (!sendBtn || !input || !historyContainer) return;

    // We keep track of the history exactly as your backend expects it
    let chatHistory = [];
    let isSending = false; // To prevent multiple simultaneous sends

    // --- Chat Logic ---
    const splitModelMessage = (text) => {
        const normalized = String(text || '').trim();
        if (!normalized) return [];

        const paragraphParts = normalized
            .split(/\n\s*\n/)
            .map(part => part.trim())
            .filter(Boolean);

        const chunks = [];
        paragraphParts.forEach((part) => {
            const sentences = part.match(/[^.!?\n]+[.!?]+(?:["')\]]+)?|[^.!?\n]+$/g) || [part];
            let buffer = [];

            sentences
                .map(sentence => sentence.trim())
                .filter(Boolean)
                .forEach((sentence, index) => {
                    buffer.push(sentence);
                    const isLast = index === sentences.length - 1;
                    if (buffer.length >= 2 || isLast) {
                        chunks.push(buffer.join(' '));
                        buffer = [];
                    }
                });
        });

        return chunks.length > 0 ? chunks : [normalized];
    };

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const getTypingDelayMs = (char) => {
        if (!char) return 18;
        if (/[.!?]/.test(char)) return 85;
        if (/[,;:]/.test(char)) return 45;
        if (/\s/.test(char)) return 12;
        return 18;
    };

    const typeText = async (element, text) => {
        const value = String(text || '');
        element.textContent = '';
        for (const char of value) {
            element.textContent += char;
            historyContainer.scrollTop = historyContainer.scrollHeight;
            await delay(getTypingDelayMs(char));
        }
    };

    const appendMessage = async (role, text) => {
        const parts = role === 'model' ? splitModelMessage(text) : [text];

        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index];
            const msgEl = document.createElement('div');
            msgEl.className = `chat-message ${role}`;
            historyContainer.appendChild(msgEl);

            if (role === 'model') {
                await typeText(msgEl, part);
                if (index < parts.length - 1) {
                    await delay(180);
                }
            } else {
                msgEl.textContent = part;
            }
        }
        
        // Auto-scroll to the bottom
        historyContainer.scrollTop = historyContainer.scrollHeight;
    };

    const sendMessage = async () => {

        if(isSending) return; // Prevent multiple sends

        const text = input.value.trim();

        if(!text) return;
        
        isSending = true;

        // Render user message instantly and lock inputs (read-only keeps focus,
        // so a phone keyboard the user opened is not closed and reopened)
        input.readOnly = true;
        sendBtn.disabled = true;
        historyContainer.setAttribute('aria-busy', 'true');
        const originalPlaceholder = input.placeholder;
        input.value = '';

        await appendMessage('user', text);


        const maxRetries = 3;
        let delayMs = 1000; // Start with 1 second delay for retries
        let lastError = null;
        let success = false;

        const lang = window.i18n && typeof window.i18n.getLanguage === 'function'
            ? window.i18n.getLanguage()
            : 'en';

        for(let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(`${SERVER_BASE_URL}/support/chat`, { 
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ 
                        message: text, 
                        history: chatHistory,
                        language: lang
                    })
                });

                if (!response.ok) {
                    let serverError = 'Failed to fetch from chat API';
                    // Read the body once: calling text() after a failed json() throws,
                    // which lost err.status and skipped the 503 retry.
                    const bodyText = await response.text().catch(() => '');
                    try {
                        const errData = JSON.parse(bodyText);
                        serverError = errData.error || errData.message || errData.details || serverError;
                    } catch (e) {
                        serverError = bodyText || serverError;
                    }
                    const err = new Error(`Server Error (${response.status}): ${serverError}`);
                    err.status = response.status;
                    throw err;
                }

                const data = await response.json();
                
                // Render the AI response
                await appendMessage('model', data.reply);
                
                // Save to history array for the NEXT request context
                chatHistory.push({ role: 'user', content: text });
                chatHistory.push({ role: 'model', content: data.reply });

                success = true;
                break; // Break out of retry loop on success

            } catch (error) {
                lastError = error;
                if(error.status === 503 && attempt < maxRetries - 1) {
                    await new Promise(res => setTimeout(res, delayMs)); // Wait before retrying
                    delayMs *= 2;
                } else {
                    break; // Do not retry for 429 or other errors
                }
            }
        }

        if (!success && lastError) {
            console.error("Support Chat Error:", lastError);
            
            const t = (key, fallback) => {
                return window.i18n && typeof window.i18n.t === 'function' && window.i18n.t(key) !== key
                    ? window.i18n.t(key)
                    : fallback;
            };
            
            // Consolidate errors: Remove previous error messages
            const existingErrors = historyContainer.querySelectorAll('.chat-message.error');
            existingErrors.forEach(el => el.remove());
            
            let userMessage = t('support_chat_error_network', "Network error. Please try again later.");
            let isRateLimit = false;

            if (lastError.status === 503) {
                userMessage = t('support_chat_error_overloaded', "The AI service is overloaded. Please try again in a moment.");
            } else if (lastError.message && (lastError.message.includes('429') || lastError.message.includes('quota'))) {
                userMessage = t('support_chat_error_rate_limit', "The AI's limit of 20 request per day is reached.");
                isRateLimit = true;
            }
            
            await appendMessage('error', userMessage);

            if (isRateLimit) {
                // Implement a 20-second cooldown
                historyContainer.removeAttribute('aria-busy');
                input.readOnly = false;
                input.disabled = true;
                let timeLeft = 20;
                input.placeholder = t('support_chat_cooldown', `Please wait ${timeLeft}s...`).replace('{sec}', timeLeft);
                
                const timerInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft <= 0) {
                        clearInterval(timerInterval);
                        isSending = false;
                        input.disabled = false;
                        sendBtn.disabled = false;
                        input.placeholder = originalPlaceholder;
                    } else {
                        input.placeholder = t('support_chat_cooldown', `Please wait ${timeLeft}s...`).replace('{sec}', timeLeft);
                    }
                }, 1000);
                
                return; // Exit early to keep input disabled during cooldown
            }
        }

        isSending = false;
        input.readOnly = false;
        sendBtn.disabled = false;
        historyContainer.removeAttribute('aria-busy');
    };

    // --- Event Listeners for sending ---
    sendBtn.addEventListener('click', sendMessage);

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
    });
}
