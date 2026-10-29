import { showOverlay, hideOverlay, getOverlay } from '../ui/overlays.js';
import { authHeaders } from '../api/authFetch.js';
import { SERVER_BASE_URL } from '../config/api.js'; // Fallback if you use full URLs

export function initSupportChat() {
    const openBtn = document.getElementById('openSupportChatBtn');
    const closeBtn = document.getElementById('closeSupportChatBtn');
    const languageBtn = document.getElementById('supportChatLanguageBtn');
    const overlay = getOverlay('supportChatOverlay'); 
    const sendBtn = document.getElementById('sendChatBtn');
    const input = document.getElementById('chatInput');
    const historyContainer = document.getElementById('chatHistoryContainer');

    // We keep track of the history exactly as your backend expects it
    let chatHistory = [];
    let isSending = false; // To prevent multiple simultaneous sends

    const updateLanguageButtonLabel = () => {
        if (!languageBtn) return;
        const label = window.i18n && typeof window.i18n.t === 'function'
            ? window.i18n.t('language_change_title')
            : 'Change Language';
        languageBtn.textContent = label;
        languageBtn.setAttribute('aria-label', label);
    };

    // --- Overlay Toggles ---
    openBtn?.addEventListener('click', () => {
        if (overlay) {
            updateLanguageButtonLabel();
            // Guarantee chat sits strictly above all other dashboard content
            overlay.style.zIndex = '9999';
            showOverlay(overlay);
            // Delay adding the class slightly to ensure the CSS transition plays
            requestAnimationFrame(() => {
                overlay.classList.add('chat-slide-in');
            });
        }
    });

    const closeChat = () => {
        if (overlay) {
            overlay.classList.remove('chat-slide-in');
            // Wait for the slide-out animation to finish before hiding the overlay
            setTimeout(() => {
                hideOverlay(overlay);
            }, 500);
        }
    };

    closeBtn?.addEventListener('click', closeChat);

    languageBtn?.addEventListener('click', () => {
        updateLanguageButtonLabel();
        if (window.i18n && typeof window.i18n.openLanguageMenu === 'function') {
            window.i18n.openLanguageMenu();
        }
    });

    overlay?.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeChat();
        }
    });

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

        // Render user message instantly and lock inputs
        input.disabled = true;
        sendBtn.disabled = true;
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
                        input.focus();
                    } else {
                        input.placeholder = t('support_chat_cooldown', `Please wait ${timeLeft}s...`).replace('{sec}', timeLeft);
                    }
                }, 1000);
                
                return; // Exit early to keep input disabled during cooldown
            }
        }

        isSending = false;
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
    };

    // --- Event Listeners for sending ---
    sendBtn?.addEventListener('click', sendMessage);
    
    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
    });

    updateLanguageButtonLabel();
}
