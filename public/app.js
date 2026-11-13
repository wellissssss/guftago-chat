// Chat App — Frontend
(function () {
  'use strict';

  // ── State ──
  let socket = null;
  let me = null;
  let otherUser = null;
  let otherName = null;
  let otherPic = null;
  let lastMessageId = 0;
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStart = 0;
  let recordingTimer = null;
  let typingTimeout = null;
  let isTyping = false;
  let reactionTarget = null;
  let contextTarget = null;
  let theme = localStorage.getItem('theme') || 'dark';
  let wallpaper = localStorage.getItem('wallpaper') || 'default';
  let soundOnNewMessage = localStorage.getItem('soundOnNewMessage') !== 'false'; // default true
  let soundOnSend = localStorage.getItem('soundOnSend') !== 'false'; // default true
  let hapticFeedback = localStorage.getItem('hapticFeedback') !== 'false'; // default true
  let replyingTo = null; // { id, sender, content, type }
const pendingSends = new Map(); // tempId -> payload for retry

  // ── DOM ──
  const $ = (sel) => document.querySelector(sel);
  const loginScreen = $('#login-screen');
  const chatScreen = $('#chat-screen');
  const loginForm = $('#login-form');
  const codeInput = $('#code-input');
  const loginError = $('#login-error');
  const messagesEl = $('#messages');
  const msgInput = $('#msg-input');
  const sendBtn = $('#send-btn');
  const replyPreview = $('#reply-preview');
  const replySender = $('#reply-sender');
  const replyText = $('#reply-text');
  const replyCancel = $('#reply-cancel');
  const attachBtn = $('#attach-btn');
  const gifBtn = $('#gif-btn');
  const voiceBtn = $('#voice-btn');
  const fileInput = $('#file-input');
const previewOverlay = $('#preview-overlay');
const previewMedia = $('#preview-media');
const previewCaption = $('#preview-caption');
const previewCancel = $('#preview-cancel');
const previewSend = $('#preview-send');
  const typingIndicator = $('#typing-indicator');
  const typingText = $('#typing-text');
  const partnerStatus = $('#partner-status');
  const chatTitle = $('#chat-title');
  const gifPanel = $('#gif-panel');
  const gifSearch = $('#gif-search');
  const gifResults = $('#gif-results');
  const gifClose = $('#gif-close');
  const voiceOverlay = $('#voice-overlay');
  const voiceTimer = $('#voice-timer');
  const reactionPicker = $('#reaction-picker');
  const contextMenu = $('#context-menu');
  const themeBtn = $('#theme-btn');
  const bookmarksBtn = $('#bookmarks-btn');
  const bookmarksPanel = $('#bookmarks-panel');
  const bookmarksClose = $('#bookmarks-close');
  const bookmarksList = $('#bookmarks-list');

  // ── Admin state ──
  let isAdmin = false;
  let adminCode = localStorage.getItem('adminCode') || '';

  // ── Theme ──
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  themeBtn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
    localStorage.setItem('theme', theme);
  });

  // ── Wallpaper ──
  const WALLPAPER_CLASSES = ['wallpaper-default','wallpaper-dark','wallpaper-light','wallpaper-blue','wallpaper-green','wallpaper-purple','wallpaper-dots','wallpaper-lines'];
  function applyWallpaper(name) {
    if (!WALLPAPER_CLASSES.includes('wallpaper-' + name)) name = 'default';
    wallpaper = name;
    WALLPAPER_CLASSES.forEach(c => messagesEl.classList.remove(c));
    messagesEl.classList.add('wallpaper-' + name);
    // update active swatch in admin if present
    const grid = document.getElementById('wallpaper-grid');
    if (grid) {
      grid.querySelectorAll('.wallpaper-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.wallpaper === name);
      });
    }
    localStorage.setItem('wallpaper', name);
  }
  // load saved on init
  applyWallpaper(wallpaper);

  // ── Utilities ──
  function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function formatTime(ts) {
    const d = new Date(ts); let h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
  }
  function formatDate(ts) {
    const d = new Date(ts), today = new Date(), yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function formatDuration(sec) { return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`; }
  function formatReadTime(ts) {
    if (Date.now() - ts < 60000) return 'Read just now';
    return 'Read at ' + formatTime(ts);
  }
  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => { messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); });
  }

  // ── Login ──
  const loginBtn = $('#login-btn');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = codeInput.value.trim();
    if (!code) return;
    loginError.textContent = '';
    const originalBtnHtml = loginBtn ? loginBtn.innerHTML : '';
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.classList.add('loading');
      loginBtn.innerHTML = '<span class="btn-spinner"></span> Verifying...';
    }
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code');
      me = { user: data.user, name: data.name, profilePic: data.profilePic };
      otherUser = data.otherUser;
      otherName = data.otherName || (isAdmin ? 'Partner' : 'Admin');
      otherPic = data.otherPic || null;
      if (data.appName) { document.title = data.appName; $('#chat-title').textContent = data.appName; }
      isAdmin = data.isAdmin || false;
      if (isAdmin) {
        adminCode = code;
        localStorage.setItem('adminCode', code);
        $('#admin-btn').style.display = 'flex';
      }
      localStorage.setItem('code', code);
      localStorage.setItem('user', me.user);
      localStorage.setItem('myName', me.name);
      localStorage.setItem('otherName', otherName);
      localStorage.setItem('myPic', me.profilePic || '');
      localStorage.setItem('otherPic', otherPic || '');
      connectSocket(code);
      showChat();
    } catch (err) { loginError.textContent = err.message; }
    finally {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.classList.remove('loading');
        loginBtn.innerHTML = originalBtnHtml || "Let's Chat! 🐱💕";
      }
    }
  });

  // Auto-login
  (function () { const c = localStorage.getItem('code'); if (c) { codeInput.value = c; loginForm.dispatchEvent(new Event('submit')); } })();

  // Cute tagline rotation
  const taglines = [
    'Meow~ your secret chat awaits 🐱',
    'Purr-fectly private conversations 💕',
    'No one else can see this 🐾',
    'Your cozy corner of the internet 🌙',
    'Chat like nobody is watching 😺',
    'Whiskers and whispers 🐱💫',
    'A secret space for two 🤫',
    'Paws and reflect on love 🐾💕',
  ];
  let taglineIndex = 0;
  const taglineEl = $('#login-tagline');
  if (taglineEl) {
    setInterval(() => {
      taglineIndex = (taglineIndex + 1) % taglines.length;
      taglineEl.style.opacity = '0';
      setTimeout(() => {
        taglineEl.textContent = taglines[taglineIndex];
        taglineEl.style.opacity = '1';
      }, 300);
    }, 4000);
  }

  function showChat() {
    loginScreen.classList.remove('active');
    chatScreen.classList.add('active');
    chatTitle.textContent = otherName || 'Chat';
    // Show profile pic in header
    const headerAvatar = $('#header-avatar');
    if (otherPic) {
      headerAvatar.innerHTML = `<img src="${escHtml(otherPic)}" alt="avatar">`;
    } else {
      headerAvatar.innerHTML = '<img src="/cat-logo.jpg" alt="cat" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    }
    loadHistory();
  }

  // ── Socket.IO ──
  function connectSocket(code) {
    socket = io({ auth: { code } });
    socket.on('connect', () => {
      if (lastMessageId > 0) socket.emit('sync', lastMessageId);
      // Auto-retry failed messages when connection is restored
      document.querySelectorAll('.message.me[data-status="failed"]').forEach(el => {
        const tempId = el.dataset.tempId;
        const payload = pendingSends.get(tempId);
        if (!payload) return;
        setMessageStatus(el, 'sending');
        el.dataset.status = 'sending';
        if (!payload.queued) {
          const wasConnected = !!(socket && socket.connected);
          if (socket) socket.emit('message', payload);
          payload.queued = !wasConnected;
        }
      });
    });
    socket.on('message', (msg) => {
      // Skip if already rendered (prevents duplicates on sync/reconnect)
      if (msg.id > 0 && document.querySelector(`.message[data-id="${msg.id}"]`)) return;
      if (msg.id > lastMessageId) lastMessageId = msg.id;
      renderMessage(msg);
      scrollToBottom();
      if (document.visibilityState === 'visible' && msg.sender !== me.user) socket.emit('read', [msg.id]);
      // Sound + haptic notification when the tab is in the background
      if (msg.sender !== me.user && document.visibilityState !== 'visible') {
        if (soundOnNewMessage) notifSound.play().catch(() => {});
        if (hapticFeedback && navigator.vibrate) navigator.vibrate(100);
      }
    });
    socket.on('message:sent', (d) => {
      const el = document.querySelector(`[data-temp-id="${d.tempId}"]`);
      if (el) {
        el.removeAttribute('data-temp-id');
        el.dataset.id = d.id;
        if (d.id > lastMessageId) lastMessageId = d.id;
        pendingSends.delete(d.tempId);
        el.dataset.status = 'sent';
        setMessageStatus(el, 'sent');
      }
    });
    socket.on('typing', (d) => {
      if (d.userId === otherUser) {
        typingIndicator.style.display = d.isTyping ? 'flex' : 'none';
        typingText.textContent = `${otherName} is typing...`;
      }
    });
    socket.on('presence', (d) => {
      if (d.userId === otherUser) {
        partnerStatus.textContent = d.online ? 'online' : 'offline';
        partnerStatus.classList.toggle('online', d.online);
      }
    });
    socket.on('reaction', (d) => updateReaction(d.messageId, d.userId, d.emoji, d.action));
    socket.on('read', (d) => {
      if (d.readBy === otherUser) d.messageIds.forEach(mid => {
        const el = document.querySelector(`.message[data-id="${mid}"]`);
        if (el && el.classList.contains('me')) {
          el.dataset.readAt = '1';
          const ts = d.readAt || Date.now();
          el.dataset.readAtTs = String(ts);
          const statusEl = el.querySelector('.message-status');
          if (statusEl && el.dataset.status === 'sent') { statusEl.textContent = '✓✓'; statusEl.classList.add('read'); }
          // Update read-time display
          let readTimeEl = el.querySelector('.read-time');
          if (!readTimeEl) {
            readTimeEl = document.createElement('div');
            readTimeEl.className = 'read-time';
            const reactionsEl = el.querySelector('.message-reactions');
            if (reactionsEl) el.insertBefore(readTimeEl, reactionsEl);
            else el.appendChild(readTimeEl);
          }
          readTimeEl.textContent = formatReadTime(ts);
        }
      });
    });
    socket.on('disconnect', () => { partnerStatus.textContent = 'reconnecting...'; partnerStatus.classList.remove('online');
      document.querySelectorAll('.message.me[data-status="sending"]').forEach(el => {
        setMessageStatus(el, 'failed');
        el.dataset.status = 'failed';
      });
    });

    // Pinned message handler
    socket.on('message:pinned', (d) => {
      const msgEl = document.querySelector(`.message[data-id="${d.id}"]`);
      if (msgEl) {
        msgEl.classList.toggle('pinned-msg', d.pinned);
      }
      updatePinnedBanner();
    });

    // Bookmarked message handler
    socket.on('message:bookmarked', (d) => {
      const msgEl = document.querySelector(`.message[data-id="${d.id}"]`);
      if (msgEl) {
        msgEl.classList.toggle('bookmarked-msg', d.bookmarked);
      }
      // Update contextTarget if open
      if (contextTarget && contextTarget.id === d.id) {
        contextTarget.bookmarked = d.bookmarked;
      }
      // Refresh bookmarks panel if open
      if (bookmarksPanel && bookmarksPanel.style.display === 'flex') {
        loadBookmarks();
      }
    });

    // Revoked event (code deactivated or session kicked)
    socket.on('revoked', (data) => {
      // Show cute popup
      const popup = document.createElement('div');
      popup.className = 'revoked-popup';
      popup.innerHTML = `
        <div class="revoked-card">
          <div class="revoked-emoji">💔</div>
          <h3>Access Revoked</h3>
          <p>${escHtml(data?.message || 'Your access has been revoked. Contact your partner for a new code.')}</p>
          <button class="admin-btn" onclick="this.parentElement.parentElement.remove()">OK</button>
        </div>
      `;
      document.body.appendChild(popup);
      // Clear stored data
      localStorage.removeItem('code');
      localStorage.removeItem('user');
      localStorage.removeItem('myName');
      localStorage.removeItem('otherName');
      localStorage.removeItem('myPic');
      localStorage.removeItem('otherPic');
      // Redirect to login after 4 seconds
      setTimeout(() => {
        popup.remove();
        chatScreen.classList.remove('active');
        loginScreen.classList.add('active');
        loginError.textContent = 'Your access was revoked. Enter a new code.';
      }, 4000);
    });

    // Connection error (code already in use)
    socket.on('connect_error', (err) => {
      if (err.message.includes('already in use')) {
        const popup = document.createElement('div');
        popup.className = 'revoked-popup';
        popup.innerHTML = `
          <div class="revoked-card">
            <div class="revoked-emoji">🔒</div>
            <h3>Code Already In Use</h3>
            <p>This code is being used on another device. Only one session per code is allowed.</p>
            <button class="admin-btn" onclick="this.parentElement.parentElement.remove()">OK</button>
          </div>
        `;
        document.body.appendChild(popup);
        setTimeout(() => {
          popup.remove();
          chatScreen.classList.remove('active');
          loginScreen.classList.add('active');
          loginError.textContent = 'Code already in use. Try a different code.';
        }, 3000);
      }
    });

    // Edit/delete handlers
    socket.on('message:edited', (d) => {
      const msgEl = document.querySelector(`.message[data-id="${d.id}"]`);
      if (!msgEl) return;
      const span = msgEl.querySelector('.msg-text');
      if (span) span.textContent = d.content;
      const timeEl = msgEl.querySelector('.message-time');
      if (timeEl && !timeEl.querySelector('.edited-label')) {
        const label = document.createElement('span');
        label.className = 'edited-label';
        label.textContent = 'edited';
        timeEl.appendChild(label);
      }
    });
    socket.on('message:deleted', (d) => {
      const msgEl = document.querySelector(`.message[data-id="${d.id}"]`);
      if (msgEl) msgEl.remove();
    });
  }

  // ── Load history ──
  function showEmptyState() {
    messagesEl.innerHTML = '<div class="empty-state"><div class="empty-icon animated-cat"><img src="/cat-logo.jpg" alt="cat" style="width:72px;height:72px;border-radius:50%;object-fit:cover;"></div><p class="empty-title">No messages yet</p><p class="empty-sub">Say meow! Your partner is waiting 💕</p></div>';
  }
  function showSkeletons() {
    messagesEl.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'skeleton-list';
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('div');
      b.className = 'skeleton-bubble ' + (i % 2 === 0 ? 'them' : 'me');
      list.appendChild(b);
    }
    messagesEl.appendChild(list);
  }
  function showErrorState() {
    messagesEl.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'error-state';
    const p = document.createElement('p');
    p.textContent = "Couldn't load messages.";
    const btn = document.createElement('button');
    btn.className = 'retry-btn';
    btn.textContent = 'Retry';
    btn.addEventListener('click', loadHistory);
    div.appendChild(p);
    div.appendChild(btn);
    messagesEl.appendChild(div);
  }
  async function loadHistory() {
    showSkeletons();
    try {
      const res = await fetch('/api/messages?limit=100');
      if (!res.ok) throw new Error('Network error');
      const msgs = await res.json();
      messagesEl.innerHTML = '';
      if (!msgs.length) { showEmptyState(); return; }
      let lastDate = '';
      msgs.forEach(msg => {
        const d = formatDate(msg.createdAt);
        if (d !== lastDate) { const div = document.createElement('div'); div.className = 'date-divider'; div.textContent = d; messagesEl.appendChild(div); lastDate = d; }
        renderMessage(msg, false);
        if (msg.id > lastMessageId) lastMessageId = msg.id;
      });
      scrollToBottom(false);
      updatePinnedBanner(msgs);
      const unread = msgs.filter(m => m.sender === otherUser && !m.readAt).map(m => m.id);
      if (unread.length && socket) socket.emit('read', unread);
    } catch (e) {
      console.error(e);
      showErrorState();
    }
  }

  // ── Pinned message banner ──
  function updatePinnedBanner(msgs) {
    const banner = $('#pinned-banner');
    const textEl = $('#pinned-text');
    if (!banner || !textEl) return;
    const pinned = msgs ? msgs.find(m => m.pinned) : null;
    // Also check DOM for pinned messages
    const pinnedMsg = pinned || (function() {
      const pinnedEl = document.querySelector('.message.pinned-msg');
      if (!pinnedEl) return null;
      const id = parseInt(pinnedEl.dataset.id, 10);
      const msgText = pinnedEl.querySelector('.msg-text');
      return { id, content: msgText ? msgText.textContent : '[media]', sender: pinnedEl.classList.contains('me') ? me.user : otherUser };
    })();
    if (pinnedMsg) {
      const senderName = pinnedMsg.sender === me.user ? 'You' : (pinnedMsg.sender === 'admin' ? 'Admin' : otherName);
      textEl.textContent = `${senderName}: ${pinnedMsg.content || '[media]'}`;
      banner.style.display = 'flex';
      banner.onclick = () => {
        const el = document.querySelector(`.message[data-id="${pinnedMsg.id}"]`);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(0,168,132,0.15)'; setTimeout(() => el.style.background = '', 1000); }
      };
    } else {
      banner.style.display = 'none';
    }
  }

  // ── Render message ──
  function renderMessage(msg, animate = true) {
    const empty = messagesEl.querySelector('.empty-state');
    if (empty) empty.remove();
    const skel = messagesEl.querySelector('.skeleton-list');
    if (skel) skel.remove();
    const isMe = msg.sender === me.user;
    const wrapper = document.createElement('div');
    wrapper.className = `message ${isMe ? 'me' : 'them'} ${msg.pinned ? 'pinned-msg' : ''} ${msg.bookmarked ? 'bookmarked-msg' : ''}`;
    wrapper.dataset.id = msg.id || 0;
    if (msg.tempId) wrapper.dataset.tempId = msg.tempId;

    let replyCtx = '';
    if (msg.replyTo && msg.replyContent) {
      const rSender = msg.replySender === me.user ? 'You' : (msg.replySender === 'admin' ? 'Admin' : otherName);
      replyCtx = `<div class="reply-context" data-reply-id="${msg.replyTo}">
        <span class="reply-context-sender">${escHtml(rSender)}</span>
        <span class="reply-context-text">${escHtml(msg.replyContent)}</span>
      </div>`;
    }

    let bubble = '';
    if (msg.type === 'text') {
      bubble = replyCtx + `<span class="msg-text">${escHtml(msg.content || '')}</span>`;
    } else if (msg.type === 'photo') {
      bubble = replyCtx + `<div class="message-media"><img src="${escHtml(msg.url)}" alt="photo" loading="lazy"></div>`;
      if (msg.content) bubble += `<div class="msg-caption">${escHtml(msg.content)}</div>`;
    } else if (msg.type === 'video') {
      bubble = replyCtx + `<div class="message-media"><video src="${escHtml(msg.url)}" controls preload="metadata" playsinline></video></div>`;
      if (msg.content) bubble += `<div class="msg-caption">${escHtml(msg.content)}</div>`;
    } else if (msg.type === 'audio') {
      const dur = msg.content ? parseFloat(msg.content) : 0;
      bubble = replyCtx + `<div class="audio-player">
        <button class="audio-play-btn" data-url="${escHtml(msg.url)}">▶</button>
        <div class="audio-waveform"><div class="audio-bars"></div><div class="audio-progress"></div></div>
        <span class="audio-time">${formatDuration(dur)}</span>
      </div>`;
    } else if (msg.type === 'gif') {
      bubble = replyCtx + `<div class="message-media gif"><img src="${escHtml(msg.url)}" alt="GIF" loading="lazy"></div>`;
    }

    const edited = msg.edited ? '<span class="edited-label">edited</span>' : '';

    const readTimeHtml = (isMe && msg.readAt) ? `<div class="read-time">${formatReadTime(msg.readAt)}</div>` : '';

    wrapper.innerHTML = `
      <div class="message-bubble">${bubble}</div>
      <div class="message-time">${formatTime(msg.createdAt)} ${edited}</div>
      ${readTimeHtml}
      <div class="message-reactions" data-msg-id="${msg.id}"></div>
    `;

    if (isMe) {
      wrapper.dataset.status = msg.status || (msg.id > 0 ? 'sent' : 'sending');
      wrapper.dataset.readAt = msg.readAt ? '1' : '';
      wrapper.dataset.readAtTs = msg.readAt ? String(msg.readAt) : '';
      setMessageStatus(wrapper, wrapper.dataset.status);
    }

    const reactionsEl = wrapper.querySelector('.message-reactions');
    renderReactions(reactionsEl, msg.id, msg.reactions || {});

    // Click bubble for context menu (long-press on mobile)
    const bubbleEl = wrapper.querySelector('.message-bubble');
    let pressTimer = null;
    bubbleEl.addEventListener('mousedown', (e) => { if (e.button === 2) { e.preventDefault(); showContextMenu(msg, bubbleEl); } });
    bubbleEl.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(msg, bubbleEl); });

    // Swipe to reply
    let touchStartX = 0, touchStartY = 0, swiping = false;
    bubbleEl.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      swiping = true;
      pressTimer = setTimeout(() => showContextMenu(msg, bubbleEl), 500);
    }, { passive: true });
    bubbleEl.addEventListener('touchmove', (e) => {
      if (!swiping) return;
      const dx = e.touches[0].clientX - touchStartX;
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dy > 10) { clearTimeout(pressTimer); swiping = false; return; } // vertical scroll, not swipe
      if (Math.abs(dx) > 10) clearTimeout(pressTimer);
      if (dx > 60) {
        // Swipe right → reply
        swiping = false;
        setReply(msg);
        // Visual feedback
        wrapper.style.transform = 'translateX(0)';
      } else if (dx > 20) {
        wrapper.style.transform = `translateX(${Math.min(dx - 20, 40)}px)`;
      }
    }, { passive: true });
    bubbleEl.addEventListener('touchend', () => {
      clearTimeout(pressTimer);
      wrapper.style.transform = 'translateX(0)';
      swiping = false;
    });

    // Double-tap for reactions
    bubbleEl.addEventListener('dblclick', (e) => { e.stopPropagation(); showReactionPicker(msg.id, bubbleEl); });

    // Audio play
    const playBtn = wrapper.querySelector('.audio-play-btn');
    if (playBtn) playBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleAudio(playBtn, msg.url); });

    // Click reply context to scroll to original
    const replyCtxEl = wrapper.querySelector('.reply-context');
    if (replyCtxEl) {
      replyCtxEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const replyId = parseInt(replyCtxEl.dataset.replyId, 10);
        const origEl = document.querySelector(`.message[data-id="${replyId}"]`);
        if (origEl) {
          origEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          origEl.style.transition = 'background 0.3s';
          origEl.style.background = 'rgba(0,168,132,0.2)';
          setTimeout(() => { origEl.style.background = ''; }, 1000);
        }
      });
    }

    // Reaction on double-tap
    bubbleEl.addEventListener('dblclick', (e) => { e.stopPropagation(); showReactionPicker(msg.id, bubbleEl); });

    messagesEl.appendChild(wrapper);
  }

  function setMessageStatus(el, status) {
    const timeEl = el.querySelector('.message-time');
    if (!timeEl) return;
    const oldStatus = timeEl.querySelector('.message-status');
    if (oldStatus) oldStatus.remove();
    const oldRetry = timeEl.querySelector('.retry-btn');
    if (oldRetry) oldRetry.remove();
    if (status === 'sending') {
      const span = document.createElement('span');
      span.className = 'message-status sending';
      span.innerHTML = '<span class="sending-spinner"></span>sending...';
      timeEl.appendChild(span);
    } else if (status === 'sent') {
      const span = document.createElement('span');
      span.className = 'message-status' + (el.dataset.readAt === '1' ? ' read' : '');
      span.textContent = el.dataset.readAt === '1' ? '✓✓' : '✓';
      timeEl.appendChild(span);
    } else if (status === 'failed') {
      const span = document.createElement('span');
      span.className = 'message-status failed';
      span.textContent = 'failed';
      timeEl.appendChild(span);
      const btn = document.createElement('button');
      btn.className = 'retry-btn';
      btn.type = 'button';
      btn.textContent = '↻';
      btn.title = 'Retry';
      btn.addEventListener('click', (e) => { e.stopPropagation(); retryMessage(el); });
      timeEl.appendChild(btn);
    }
  }

  function retryMessage(el) {
    const tempId = el.dataset.tempId;
    if (!tempId) return;
    const payload = pendingSends.get(tempId);
    if (!payload) return;
    setMessageStatus(el, 'sending');
    el.dataset.status = 'sending';
    const wasConnected = !!(socket && socket.connected);
    if (socket) socket.emit('message', payload);
    payload.queued = !wasConnected;
    if (!wasConnected) {
      setMessageStatus(el, 'failed');
      el.dataset.status = 'failed';
    }
  }

  function renderReactions(container, msgId, reactions) {
    container.innerHTML = '';
    Object.entries(reactions).forEach(([emoji, users]) => {
      const chip = document.createElement('span');
      chip.className = `reaction-chip ${users.includes(me.user) ? 'mine' : ''}`;
      chip.innerHTML = `${emoji}<span class="reaction-count">${users.length}</span>`;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('reaction', { messageId: msgId, emoji, action: users.includes(me.user) ? 'remove' : 'add' });
      });
      container.appendChild(chip);
    });
  }

  function updateReaction(msgId, userId, emoji, action) {
    const container = document.querySelector(`.message-reactions[data-msg-id="${msgId}"]`);
    if (!container) return;
    let chip = null;
    container.querySelectorAll('.reaction-chip').forEach(c => { if (c.textContent.trim().startsWith(emoji)) chip = c; });
    if (action === 'add') {
      if (chip) {
        const count = chip.querySelector('.reaction-count');
        count.textContent = parseInt(count.textContent, 10) + 1;
        if (userId === me.user) chip.classList.add('mine');
      } else {
        const newChip = document.createElement('span');
        newChip.className = `reaction-chip ${userId === me.user ? 'mine' : ''}`;
        newChip.innerHTML = `${emoji}<span class="reaction-count">1</span>`;
        newChip.addEventListener('click', (e) => { e.stopPropagation(); socket.emit('reaction', { messageId: msgId, emoji, action: 'remove' }); });
        container.appendChild(newChip);
      }
    } else if (chip) {
      const count = chip.querySelector('.reaction-count');
      const n = parseInt(count.textContent, 10) - 1;
      if (n <= 0) chip.remove(); else count.textContent = n;
      if (userId === me.user) chip.classList.remove('mine');
    }
  }

  // ── Enter-to-Send setting ──
  let enterToSend = localStorage.getItem('enterToSend') !== 'false'; // default true

  // ── Auto-resize textarea ──
  function autoResize() {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
  }

  // ── Send text ──
  function sendText() {
    const text = msgInput.value.trim();
    if (!text) return;
    const tempId = 'temp-' + Date.now();
    const replyData = replyingTo ? { replyTo: replyingTo.id, replyContent: replyingTo.content || replyingTo.type, replySender: replyingTo.sender } : {};
    const payload = { tempId, type: 'text', content: text, replyTo: replyingTo?.id || null };
    pendingSends.set(tempId, payload);
    renderMessage({ id: 0, tempId, sender: me.user, type: 'text', content: text, createdAt: Date.now(), reactions: {}, status: 'sending', ...replyData });
    scrollToBottom();
    const wasConnected = !!(socket && socket.connected);
    if (socket) socket.emit('message', payload);
    payload.queued = !wasConnected;
    if (!wasConnected) {
      const el = document.querySelector(`[data-temp-id="${tempId}"]`);
      if (el) { setMessageStatus(el, 'failed'); el.dataset.status = 'failed'; }
    }
    msgInput.value = '';
    msgInput.style.height = 'auto';
    cancelReply();
    stopTyping();
    if (soundOnSend) notifSound.play().catch(() => {});
  }
  sendBtn.addEventListener('click', sendText);
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (enterToSend && !e.shiftKey) {
        e.preventDefault();
        sendText();
      }
      // If enterToSend is false, Enter creates new line (default textarea behavior)
      // Ctrl+Enter or Cmd+Enter sends
      if (!enterToSend && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendText();
      }
    }
  });
  msgInput.addEventListener('input', () => {
    autoResize();
    if (!isTyping) { isTyping = true; socket.emit('typing', true); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 2000);
  });

  // ── Reply functions ──
  function setReply(msg) {
    replyingTo = msg;
    const senderName = msg.sender === me.user ? 'You' : (msg.sender === 'admin' ? 'Admin' : otherName);
    replySender.textContent = senderName;
    let preview = msg.content || '';
    if (msg.type !== 'text') preview = `[${msg.type}]`;
    replyText.textContent = preview;
    replyPreview.style.display = 'flex';
    msgInput.focus();
  }

  function cancelReply() {
    replyingTo = null;
    replyPreview.style.display = 'none';
  }

  replyCancel.addEventListener('click', cancelReply);

  // ── Swipe to reply ──
  // Add swipe gesture to messages in renderMessage
  // (handled below via touch events on message bubbles)
  function stopTyping() { if (isTyping) { isTyping = false; socket.emit('typing', false); } clearTimeout(typingTimeout); }

  // ── File upload ──
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type.startsWith('audio/')) {
      await uploadFile(file);
    } else {
      showPreview(file);
    }
    fileInput.value = '';
  });

  // Client-side image compression using canvas (zero dependencies)
  async function compressImage(file) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob && blob.size < file.size) {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          } else {
            resolve(file);
          }
        }, 'image/jpeg', 0.75);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  // ── Media preview before sending ──
  let previewFile = null;
  let previewUrl = null;

  function showPreview(file) {
    previewFile = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    previewMedia.innerHTML = '';
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = previewUrl;
      img.alt = 'preview';
      previewMedia.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = previewUrl;
      video.controls = true;
      video.playsInline = true;
      previewMedia.appendChild(video);
    }
    previewCaption.value = '';
    previewOverlay.style.display = 'flex';
    setTimeout(() => { try { previewCaption.focus(); } catch (e) {} }, 50);
  }

  function closePreview() {
    previewOverlay.style.display = 'none';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    previewFile = null;
    previewMedia.innerHTML = '';
  }

  if (previewCancel) previewCancel.addEventListener('click', closePreview);
  if (previewSend) previewSend.addEventListener('click', async () => {
    if (!previewFile) return;
    const file = previewFile;
    const caption = previewCaption.value.trim();
    closePreview();
    await uploadFile(file, caption);
  });
  if (previewOverlay) previewOverlay.addEventListener('click', (e) => {
    if (e.target === previewOverlay) closePreview();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && previewOverlay && previewOverlay.style.display === 'flex') closePreview();
  });

  function showUploadProgress(pct) {
    const bar = $('#upload-progress');
    if (!bar) return;
    bar.style.display = 'block';
    updateUploadProgress(pct);
  }
  function updateUploadProgress(pct) {
    const fill = $('#upload-progress-bar');
    const text = $('#upload-progress-text');
    if (fill) fill.style.width = (pct || 0) + '%';
    if (text) text.textContent = `Uploading... ${pct || 0}%`;
  }
  function hideUploadProgress() {
    const bar = $('#upload-progress');
    if (bar) bar.style.display = 'none';
    const fill = $('#upload-progress-bar');
    if (fill) fill.style.width = '0%';
  }
  async function uploadFile(file, caption = '') {
    // Compress images client-side before upload
    if (file.type.startsWith('image/') && file.type !== 'image/gif') {
      file = await compressImage(file);
    }
    const formData = new FormData();
    formData.append('file', file);
    const content = caption || '';
    showUploadProgress(0);
    try {
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            updateUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          let parsed = null;
          try { parsed = JSON.parse(xhr.responseText); } catch (err) { parsed = null; }
          if (xhr.status >= 200 && xhr.status < 300 && parsed) {
            resolve(parsed);
          } else {
            reject(new Error((parsed && parsed.error) || 'Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });
      hideUploadProgress();
      const tempId = 'temp-' + Date.now();
      const replyData = replyingTo ? { replyTo: replyingTo.id, replyContent: replyingTo.content || replyingTo.type, replySender: replyingTo.sender } : {};
      const payload = { tempId, type: data.type, content, filename: data.filename, mimetype: data.mimetype, size: data.size, replyTo: replyingTo?.id || null };
      pendingSends.set(tempId, payload);
      renderMessage({ id: 0, tempId, sender: me.user, type: data.type, content, url: data.url, createdAt: Date.now(), reactions: {}, status: 'sending', ...replyData });
      scrollToBottom();
      const wasConnected = !!(socket && socket.connected);
      if (socket) socket.emit('message', payload);
      payload.queued = !wasConnected;
      if (!wasConnected) {
        const el = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (el) { setMessageStatus(el, 'failed'); el.dataset.status = 'failed'; }
      }
      cancelReply();
      if (soundOnSend) notifSound.play().catch(() => {});
    } catch (err) { hideUploadProgress(); alert('Upload failed: ' + err.message); }
  }

  // ── Voice recording (high quality) ──
  voiceBtn.addEventListener('click', () => { isRecording ? stopRecording() : startRecording(); });

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm';
      mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
      audioChunks = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });
        await uploadFile(file);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start(250);
      isRecording = true;
      voiceBtn.classList.add('recording');
      voiceOverlay.style.display = 'flex';
      recordingStart = Date.now();
      recordingTimer = setInterval(() => {
        const sec = (Date.now() - recordingStart) / 1000;
        voiceTimer.textContent = formatDuration(sec);
        if (sec >= 120) stopRecording();
      }, 200);
    } catch (err) { alert('Microphone access denied: ' + err.message); }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceOverlay.style.display = 'none';
    clearInterval(recordingTimer);
  }
  voiceOverlay.addEventListener('click', stopRecording);

  // ── Audio playback with real waveform (from quick-chat-react pattern) ──
  let currentAudio = null, currentBtn = null;
  const waveformCache = new Map();

  async function generateWaveform(url, barsEl) {
    if (waveformCache.has(url)) {
      renderWaveformBars(barsEl, waveformCache.get(url));
      return;
    }
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const rawData = audioBuffer.getChannelData(0);
      const barCount = 32;
      const samplesPerBar = Math.floor(rawData.length / barCount);
      const bars = [];
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        const start = i * samplesPerBar;
        for (let j = start; j < start + samplesPerBar && j < rawData.length; j++) {
          sum += Math.abs(rawData[j]);
        }
        bars.push(sum / samplesPerBar);
      }
      const max = Math.max(...bars, 0.01);
      const normalized = bars.map(v => Math.max(0.08, v / max));
      waveformCache.set(url, normalized);
      renderWaveformBars(barsEl, normalized);
      await audioCtx.close();
    } catch (e) {
      // Fallback: random bars
      const bars = Array.from({ length: 32 }, () => 0.15 + Math.random() * 0.85);
      waveformCache.set(url, bars);
      renderWaveformBars(barsEl, bars);
    }
  }

  function renderWaveformBars(container, bars) {
    container.innerHTML = '';
    bars.forEach((v, i) => {
      const bar = document.createElement('div');
      bar.className = 'wave-bar';
      bar.style.height = (v * 100) + '%';
      container.appendChild(bar);
    });
  }

  function toggleAudio(btn, url) {
    const playerEl = btn.parentElement;
    const barsContainer = playerEl.querySelector('.audio-bars');
    const progressEl = playerEl.querySelector('.audio-progress');
    const timeEl = playerEl.querySelector('.audio-time');

    if (currentAudio && currentBtn === btn) {
      if (currentAudio.paused) { currentAudio.play(); btn.textContent = '⏸'; }
      else { currentAudio.pause(); btn.textContent = '▶'; }
      return;
    }
    if (currentAudio) { currentAudio.pause(); if (currentBtn) currentBtn.textContent = '▶'; }

    // Generate waveform if not already done
    if (barsContainer && !barsContainer.children.length) {
      generateWaveform(url, barsContainer);
    }

    const audio = new Audio(url);
    currentAudio = audio; currentBtn = btn;
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        const pct = (audio.currentTime / audio.duration) * 100;
        if (progressEl) progressEl.style.width = pct + '%';
        if (timeEl) timeEl.textContent = `${formatDuration(audio.currentTime)} / ${formatDuration(audio.duration)}`;
      }
    });
    audio.addEventListener('ended', () => { btn.textContent = '▶'; if (progressEl) progressEl.style.width = '0%'; currentAudio = null; currentBtn = null; });
    audio.addEventListener('loadedmetadata', () => { if (timeEl) timeEl.textContent = `0:00 / ${formatDuration(audio.duration)}`; });
    audio.play(); btn.textContent = '⏸';
  }

  // ── GIF panel ──
  gifBtn.addEventListener('click', () => {
    gifPanel.style.display = gifPanel.style.display === 'none' ? 'flex' : 'none';
    if (gifPanel.style.display === 'flex') $('#gif-url-input').focus();
  });
  gifClose.addEventListener('click', () => { gifPanel.style.display = 'none'; });

  const gifUrlInput = $('#gif-url-input');
  const gifUrlSend = $('#gif-url-send');
  const gifUploadBtn = $('#gif-upload-btn');
  const gifFileInput = $('#gif-file-input');

  function sendGifUrl() {
    const url = gifUrlInput.value.trim();
    if (!url) return;
    gifPanel.style.display = 'none';
    const tempId = 'temp-' + Date.now();
    const replyData = replyingTo ? { replyTo: replyingTo.id, replyContent: replyingTo.content || replyingTo.type, replySender: replyingTo.sender } : {};
    const payload = { tempId, type: 'gif', content: url, replyTo: replyingTo?.id || null };
    pendingSends.set(tempId, payload);
    renderMessage({ id: 0, tempId, sender: me.user, type: 'gif', content: '', url, createdAt: Date.now(), reactions: {}, status: 'sending', ...replyData });
    scrollToBottom();
    const wasConnected = !!(socket && socket.connected);
    if (socket) socket.emit('message', payload);
    payload.queued = !wasConnected;
    if (!wasConnected) {
      const el = document.querySelector(`[data-temp-id="${tempId}"]`);
      if (el) { setMessageStatus(el, 'failed'); el.dataset.status = 'failed'; }
    }
    cancelReply();
    gifUrlInput.value = '';
    if (soundOnSend) notifSound.play().catch(() => {});
  }
  gifUrlSend.addEventListener('click', sendGifUrl);
  gifUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendGifUrl(); } });

  gifUploadBtn.addEventListener('click', () => gifFileInput.click());
  gifFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    gifPanel.style.display = 'none';
    await uploadFile(file);
    gifFileInput.value = '';
  });

  // ── Reaction picker ──
  function showReactionPicker(msgId, anchor) {
    reactionTarget = msgId;
    const rect = anchor.getBoundingClientRect();
    reactionPicker.style.display = 'flex';
    const pickerWidth = reactionPicker.offsetWidth || 300;
    let top = rect.top - 52;
    if (top < 10) top = rect.bottom + 8;
    if (top + 50 > window.innerHeight) top = window.innerHeight - 60;
    reactionPicker.style.top = Math.max(10, top) + 'px';
    let left = rect.left;
    if (left + pickerWidth > window.innerWidth - 10) left = window.innerWidth - pickerWidth - 10;
    if (left < 10) left = 10;
    reactionPicker.style.left = left + 'px';
    clearTimeout(window._rpTimeout);
    window._rpTimeout = setTimeout(() => { reactionPicker.style.display = 'none'; }, 5000);
  }
  reactionPicker.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (reactionTarget) socket.emit('reaction', { messageId: reactionTarget, emoji: btn.dataset.emoji, action: 'add' });
      reactionPicker.style.display = 'none'; reactionTarget = null;
    });
  });

  // ── Context menu ──
  function showContextMenu(msg, anchor) {
    contextTarget = msg;
    const rect = anchor.getBoundingClientRect();
    // Quick reactions row
    let html = '<div style="display:flex;gap:2px;padding:6px 8px;border-bottom:1px solid var(--wa-border);">';
    ['❤️','😂','😍','😮','😢','👍','🔥'].forEach(e => {
      html += `<button onclick="window._ctxReact('${e}')" style="width:30px;height:30px;border:none;background:none;font-size:16px;cursor:pointer;border-radius:50%;" onmouseover="this.style.background='var(--wa-input-bg)'" onmouseout="this.style.background='none'">${e}</button>`;
    });
    html += '</div>';
    html += `<button onclick="window._ctxReply()"><span class="menu-icon">↩</span> Reply</button>`;
    html += `<button onclick="window._ctxPin()"><span class="menu-icon">📌</span> ${contextTarget.pinned ? 'Unpin' : 'Pin'}</button>`;
    html += `<button onclick="window._ctxBookmark()"><span class="menu-icon">⭐</span> ${contextTarget.bookmarked ? 'Remove Bookmark' : 'Bookmark'}</button>`;
    if (msg.type === 'text') html += `<button onclick="window._ctxCopy()"><span class="menu-icon">📋</span> Copy</button>`;
    if (msg.sender === me.user) {
      if (msg.type === 'text') html += `<button onclick="window._ctxEdit()"><span class="menu-icon">✏️</span> Edit</button>`;
      html += `<button class="danger" onclick="window._ctxDelete()"><span class="menu-icon">🗑</span> Delete</button>`;
    }
    contextMenu.innerHTML = html;
    contextMenu.style.display = 'block';
    const menuHeight = contextMenu.offsetHeight || 220;
    const menuWidth = contextMenu.offsetWidth || 180;
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - 10) top = rect.top - menuHeight - 4;
    if (top < 10) top = 10;
    contextMenu.style.top = top + 'px';
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
    if (left < 10) left = 10;
    contextMenu.style.left = left + 'px';
    clearTimeout(window._cmTimeout);
    window._cmTimeout = setTimeout(() => { contextMenu.style.display = 'none'; }, 4000);
  }

  window._ctxReact = function(emoji) {
    if (contextTarget) socket.emit('reaction', { messageId: contextTarget.id, emoji, action: 'add' });
    contextMenu.style.display = 'none';
  };

  window._ctxPin = function () {
    if (contextTarget) {
      socket.emit('pin', { messageId: contextTarget.id, pinned: !contextTarget.pinned });
      contextTarget.pinned = !contextTarget.pinned;
    }
    contextMenu.style.display = 'none';
  };

  window._ctxBookmark = function () {
    if (contextTarget) {
      const newState = !contextTarget.bookmarked;
      socket.emit('bookmark', { messageId: contextTarget.id, bookmarked: newState });
      contextTarget.bookmarked = newState;
      const msgEl = document.querySelector(`.message[data-id="${contextTarget.id}"]`);
      if (msgEl) msgEl.classList.toggle('bookmarked-msg', newState);
    }
    contextMenu.style.display = 'none';
  };

  window._ctxReply = function () {
    if (contextTarget) setReply(contextTarget);
    contextMenu.style.display = 'none';
  };

  window._ctxCopy = function () {
    if (contextTarget?.content) navigator.clipboard?.writeText(contextTarget.content).catch(() => {});
    contextMenu.style.display = 'none';
  };
  window._ctxEdit = function () {
    contextMenu.style.display = 'none';
    const msgEl = document.querySelector(`.message[data-id="${contextTarget.id}"]`);
    if (!msgEl) return;
    const bubble = msgEl.querySelector('.message-bubble');
    const span = bubble.querySelector('.msg-text');
    if (!span) return;
    const input = document.createElement('input');
    input.className = 'edit-input';
    input.value = contextTarget.content;
    span.replaceWith(input);
    input.focus();
    const save = () => {
      const newText = input.value.trim();
      if (newText && newText !== contextTarget.content) {
        // Update locally
        const newSpan = document.createElement('span');
        newSpan.className = 'msg-text';
        newSpan.textContent = newText;
        input.replaceWith(newSpan);
        contextTarget.content = newText;
        // Mark edited
        const timeEl = msgEl.querySelector('.message-time');
        if (timeEl && !timeEl.querySelector('.edited-label')) {
          const label = document.createElement('span');
          label.className = 'edited-label';
          label.textContent = 'edited';
          timeEl.appendChild(label);
        }
        // Notify server (emit edit event)
        socket.emit('edit', { messageId: contextTarget.id, content: newText });
      } else {
        const newSpan = document.createElement('span');
        newSpan.className = 'msg-text';
        newSpan.textContent = contextTarget.content;
        input.replaceWith(newSpan);
      }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { input.value = contextTarget.content; input.blur(); } });
  };
  window._ctxDelete = function () {
    contextMenu.style.display = 'none';
    if (!confirm('Delete this message?')) return;
    const msgEl = document.querySelector(`.message[data-id="${contextTarget.id}"]`);
    if (msgEl) msgEl.remove();
    socket.emit('delete', { messageId: contextTarget.id });
  };

  // ── Bookmarks panel logic ──
  async function loadBookmarks() {
    if (!bookmarksList) return;
    bookmarksList.innerHTML = '<p class="admin-desc">Loading...</p>';
    try {
      const res = await fetch('/api/bookmarks');
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        bookmarksList.innerHTML = '<p class="admin-desc">No bookmarked messages yet.</p>';
        return;
      }
      bookmarksList.innerHTML = rows.map(m => {
        const senderName = m.sender === me.user ? 'You' : (m.sender === 'admin' ? 'Admin' : otherName);
        const preview = m.type === 'text' ? (m.content || '') : `[${m.type}]`;
        return `
          <div class="bookmark-item" data-id="${m.id}">
            <div class="bookmark-meta">
              <span><span class="bookmark-sender">${escHtml(senderName)}</span> · ${formatTime(m.createdAt)}</span>
              <button class="bookmark-remove" data-id="${m.id}" title="Remove bookmark">✕</button>
            </div>
            <div class="bookmark-content">${escHtml(preview)}</div>
          </div>
        `;
      }).join('');
      // click to scroll
      bookmarksList.querySelectorAll('.bookmark-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('bookmark-remove')) return;
          const id = parseInt(item.dataset.id, 10);
          const origEl = document.querySelector(`.message[data-id="${id}"]`);
          if (origEl) {
            origEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            origEl.style.transition = 'background 0.3s';
            origEl.style.background = 'rgba(245,166,35,0.25)';
            setTimeout(() => { origEl.style.background = ''; }, 1000);
          }
          if (bookmarksPanel) bookmarksPanel.style.display = 'none';
        });
      });
      // remove bookmark
      bookmarksList.querySelectorAll('.bookmark-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id, 10);
          socket.emit('bookmark', { messageId: id, bookmarked: false });
          // update contextTarget if needed
          const item = btn.closest('.bookmark-item');
          if (item) item.remove();
          const msgEl = document.querySelector(`.message[data-id="${id}"]`);
          if (msgEl) msgEl.classList.remove('bookmarked-msg');
          // refresh if empty
          if (!bookmarksList.querySelector('.bookmark-item')) {
            bookmarksList.innerHTML = '<p class="admin-desc">No bookmarked messages yet.</p>';
          }
        });
      });
    } catch (e) {
      console.error(e);
      bookmarksList.innerHTML = '<p class="admin-desc">Failed to load bookmarks.</p>';
    }
  }

  // ── Hide menus on outside click ──
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.style.display = 'none';
    if (!reactionPicker.contains(e.target)) reactionPicker.style.display = 'none';
  });

  // ── Visibility / read receipts ──
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && socket) {
      const unread = [];
      document.querySelectorAll('.message.them').forEach(el => {
        const id = parseInt(el.dataset.id, 10);
        if (id > 0) unread.push(id);
      });
      if (unread.length) socket.emit('read', unread);
    }
  });

  // ── Admin Panel ──
  const searchBtn = $('#search-btn');
  const searchBar = $('#search-bar');
  const searchInput = $('#search-input');
  const searchClose = $('#search-close');
  const exportBtn = $('#export-btn');
  const adminBtn = $('#admin-btn');
  const adminPanel = $('#admin-panel');
  const adminClose = $('#admin-close');
  const genCodeBtn = $('#gen-code-btn');
  const partnerNameInput = $('#partner-name-input');
  const customCodeInput = $('#custom-code-input');
  const adminNameInput = $('#admin-name-input');
  const updateNameBtn = $('#update-name-btn');
  const pickCatMe = $('#pick-cat-me');
  const pickCatPartner = $('#pick-cat-partner');
  const catPreview = $('#cat-preview');
  const enterSendToggle = $('#enter-send-toggle');
  const soundNewToggle = $('#sound-new-toggle');
  const soundSendToggle = $('#sound-send-toggle');
  const hapticToggle = $('#haptic-toggle');
  const sessionsList = $('#sessions-list');
  const wallpaperGrid = $('#wallpaper-grid');

  // Enter-to-Send toggle
  if (enterToSend) enterSendToggle.classList.add('active');
  enterSendToggle.addEventListener('click', () => {
    enterToSend = !enterToSend;
    enterSendToggle.classList.toggle('active', enterToSend);
    localStorage.setItem('enterToSend', enterToSend.toString());
  });

  // Sound on new message toggle
  if (soundOnNewMessage) soundNewToggle.classList.add('active');
  soundNewToggle.addEventListener('click', () => {
    soundOnNewMessage = !soundOnNewMessage;
    soundNewToggle.classList.toggle('active', soundOnNewMessage);
    localStorage.setItem('soundOnNewMessage', soundOnNewMessage.toString());
  });

  // Sound on send toggle
  if (soundOnSend) soundSendToggle.classList.add('active');
  soundSendToggle.addEventListener('click', () => {
    soundOnSend = !soundOnSend;
    soundSendToggle.classList.toggle('active', soundOnSend);
    localStorage.setItem('soundOnSend', soundOnSend.toString());
  });

  // Haptic feedback toggle
  if (hapticFeedback) hapticToggle.classList.add('active');
  hapticToggle.addEventListener('click', () => {
    hapticFeedback = !hapticFeedback;
    hapticToggle.classList.toggle('active', hapticFeedback);
    localStorage.setItem('hapticFeedback', hapticFeedback.toString());
  });

  // Wallpaper picker
  if (wallpaperGrid) {
    wallpaperGrid.querySelectorAll('.wallpaper-btn').forEach(btn => {
      btn.addEventListener('click', () => applyWallpaper(btn.dataset.wallpaper));
    });
  }
  const genCodeResult = $('#gen-code-result');
  const newCodeDisplay = $('#new-code-display');
  const copyCodeBtn = $('#copy-code-btn');
  const codesList = $('#codes-list');

  adminBtn.addEventListener('click', () => {
    adminPanel.style.display = 'flex';
    adminNameInput.value = me.name || '';
    loadCodes();
    loadSessions();
    applyWallpaper(wallpaper);
  });

  // Bookmarks panel
  if (bookmarksBtn) {
    bookmarksBtn.addEventListener('click', () => {
      if (bookmarksPanel) {
        bookmarksPanel.style.display = 'flex';
        loadBookmarks();
      }
    });
  }
  if (bookmarksClose) {
    bookmarksClose.addEventListener('click', () => {
      if (bookmarksPanel) bookmarksPanel.style.display = 'none';
    });
  }
  if (bookmarksPanel) {
    bookmarksPanel.addEventListener('click', (e) => {
      if (e.target === bookmarksPanel) bookmarksPanel.style.display = 'none';
    });
  }

  async function loadSessions() {
    try {
      const res = await fetch('/api/admin/sessions', { headers: { 'X-Admin-Code': adminCode } });
      const sessions = await res.json();
      if (!Array.isArray(sessions)) return;
      if (sessions.length === 0) {
        sessionsList.innerHTML = '<p class="admin-desc">No active sessions</p>';
        return;
      }
      sessionsList.innerHTML = sessions.map(s => `
        <div class="code-item">
          <div>
            <span class="code-val">${escHtml(s.name)}</span>
            <span class="code-role">${escHtml(s.role)} — ${escHtml(s.code)}</span>
          </div>
          <button class="deactivate-btn" data-code="${escHtml(s.code)}" title="Kick session" style="background:var(--wa-danger);">⚡</button>
        </div>
      `).join('');
      sessionsList.querySelectorAll('.deactivate-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Kick this session? They will be disconnected.')) return;
          try {
            const res = await fetch('/api/admin/kick-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode },
              body: JSON.stringify({ code: btn.dataset.code, adminCode }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            loadSessions();
          } catch (err) { alert(err.message); }
        });
      });
    } catch (e) { console.error(e); }
  }

  updateNameBtn.addEventListener('click', async () => {
    const name = adminNameInput.value.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/admin/update-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode },
        body: JSON.stringify({ name, adminCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      me.name = name;
      localStorage.setItem('myName', name);
      alert('Name updated! Your partner will see "' + name + '"');
    } catch (err) { alert(err.message); }
  });

  // Profile picture picker - uses free APIs (Cataas for cats, DiceBear for avatars)
  async function pickCatPic(target) {
    // Try Cataas first, fall back to DiceBear
    let url = null;
    try {
      const res = await fetch('https://cataas.com/cat?json=true');
      const catData = await res.json();
      const catId = catData.id;
      if (catId) url = `https://cataas.com/cat/${catId}`;
    } catch (e) { /* fall through to DiceBear */ }
    if (!url) {
      // DiceBear fallback (free, no auth, consistent per seed)
      const seed = target === 'admin' ? me.name : (partnerNameInput.value.trim() || 'partner');
      url = `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`;
    }
    catPreview.innerHTML = `<img src="${url}" style="width:120px;height:120px;border-radius:50%;object-fit:cover;" alt="pic">`;
    try {
      const updateRes = await fetch('/api/admin/update-pic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode },
        body: JSON.stringify({ picUrl: url, target, adminCode }),
      });
      const data = await updateRes.json();
      if (!updateRes.ok) throw new Error(data.error || 'Failed');
      if (target === 'admin') {
        me.profilePic = url;
        localStorage.setItem('myPic', url);
        const headerAvatar = $('#header-avatar');
        if (headerAvatar && otherPic) {
          headerAvatar.innerHTML = `<img src="${escHtml(otherPic)}" alt="avatar">`;
        }
        alert('Your profile picture updated!');
      } else {
        otherPic = url;
        localStorage.setItem('otherPic', url);
        const headerAvatar = $('#header-avatar');
        if (headerAvatar) {
          headerAvatar.innerHTML = `<img src="${escHtml(url)}" alt="avatar">`;
        }
        alert("Partner's profile picture updated!");
      }
    } catch (err) { alert('Failed to update picture: ' + err.message); }
  }
  pickCatMe.addEventListener('click', () => pickCatPic('admin'));
  pickCatPartner.addEventListener('click', () => pickCatPic('partner'));
  adminClose.addEventListener('click', () => { adminPanel.style.display = 'none'; });

  genCodeBtn.addEventListener('click', async () => {
    const name = partnerNameInput.value.trim() || 'Partner';
    const customCode = customCodeInput.value.trim().toUpperCase();
    try {
      const res = await fetch('/api/admin/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode },
        body: JSON.stringify({ name, customCode, adminCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      newCodeDisplay.textContent = data.code;
      genCodeResult.style.display = 'block';
      localStorage.setItem('partnerName', name);
      customCodeInput.value = '';
      loadCodes();
    } catch (err) { alert(err.message); }
  });

  copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(newCodeDisplay.textContent).catch(() => {});
    copyCodeBtn.textContent = 'Copied!';
    setTimeout(() => { copyCodeBtn.textContent = 'Copy Code'; }, 2000);
  });

  async function loadCodes() {
    try {
      const res = await fetch('/api/admin/codes', { headers: { 'X-Admin-Code': adminCode } });
      const codes = await res.json();
      if (!Array.isArray(codes)) return;
      codesList.innerHTML = codes.map(c => `
        <div class="code-item">
          <div>
            <span class="code-val">${escHtml(c.code)}</span>
            <span class="code-role">${escHtml(c.role)}${c.name ? ' — ' + escHtml(c.name) : ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="code-status ${c.active ? 'active' : 'inactive'}">${c.active ? 'Active' : 'Inactive'}</span>
            ${c.active && c.role !== 'admin' ? `<button class="deactivate-btn" data-code="${escHtml(c.code)}" title="Deactivate">✕</button>` : ''}
          </div>
        </div>
      `).join('');
      // Attach deactivate handlers
      codesList.querySelectorAll('.deactivate-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Deactivate this code? The person using it will be logged out.')) return;
          try {
            const res = await fetch('/api/admin/deactivate-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode },
              body: JSON.stringify({ code: btn.dataset.code, adminCode }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            loadCodes();
          } catch (err) { alert(err.message); }
        });
      });
    } catch (e) { console.error(e); }
  }

  // ── Pinned close button ──
  const pinnedClose = $('#pinned-close');
  if (pinnedClose) {
    pinnedClose.addEventListener('click', () => {
      const banner = $('#pinned-banner');
      if (banner) banner.style.display = 'none';
    });
  }

  // ── Search ──
  searchBtn.addEventListener('click', () => {
    searchBar.style.display = searchBar.style.display === 'none' ? 'flex' : 'none';
    if (searchBar.style.display === 'flex') searchInput.focus();
    else clearSearch();
  });
  searchClose.addEventListener('click', () => { searchBar.style.display = 'none'; clearSearch(); });

  function clearSearch() {
    document.querySelectorAll('.search-highlight').forEach(el => {
      el.outerHTML = el.textContent;
    });
    searchInput.value = '';
  }

  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const query = searchInput.value.trim().toLowerCase();
      if (!query) { clearSearch(); return; }
      document.querySelectorAll('.search-highlight').forEach(el => { el.outerHTML = el.textContent; });
      let count = 0;
      document.querySelectorAll('.msg-text').forEach(el => {
        const text = el.textContent;
        if (text.toLowerCase().includes(query)) {
          const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          el.innerHTML = escHtml(text).replace(regex, '<span class="search-highlight">$1</span>');
          count++;
          if (count === 1) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }, 300);
  });

  // ── Export chat ──
  exportBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/messages?limit=500');
      const msgs = await res.json();
      let text = 'Guftago Chat Export\\n';
      text += 'Exported: ' + new Date().toLocaleString() + '\\n';
      text += '='.repeat(40) + '\\n\\n';
      msgs.forEach(m => {
        const sender = m.sender === me.user ? (me.name || 'You') : (otherName || 'Partner');
        const time = new Date(m.createdAt).toLocaleString();
        let content = m.content || '';
        if (m.type !== 'text') content = `[${m.type}] ${content}`;
        text += `[${time}] ${sender}: ${content}\\n`;
        if (m.reactions && Object.keys(m.reactions).length) {
          text += `  Reactions: ${Object.keys(m.reactions).join(' ')}\\n`;
        }
      });
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `guftago-chat-${new Date().toISOString().slice(0,10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert('Export failed: ' + e.message); }
  });

  // ── Drag & drop files ──
  let dropOverlay = null;
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dropOverlay) {
      dropOverlay = document.createElement('div');
      dropOverlay.className = 'drop-overlay';
      dropOverlay.textContent = '📎 Drop file to send';
      document.body.appendChild(dropOverlay);
    }
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null && dropOverlay) {
      dropOverlay.remove();
      dropOverlay = null;
    }
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; }
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      if (file.type.startsWith('audio/')) uploadFile(file);
      else showPreview(file);
    }
  });

  // ── Sound notification ──
  const notifSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleScFlPbGp3EhBzOG1N+0ZSYElvPSqXUjBzOG1N+0ZSYElvPSqXUjBzOG1N+0ZSYElvPSqXUjBzOG1N+0ZSYElvPSqXUjA=');

  // ── Haptic feedback on send ──
  sendBtn.addEventListener('click', () => {
    if (hapticFeedback && navigator.vibrate) navigator.vibrate(50);
  }, true);

  // ── Mobile keyboard: keep the composer above the on-screen keyboard ──
  (function initViewportSizing() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const syncHeight = () => {
      root.style.setProperty('--app-height', vv.height + 'px');
    };
    vv.addEventListener('resize', syncHeight);
    // iOS Safari can scroll the layout viewport when an input is focused;
    // pin it back so the header never drifts off-screen.
    vv.addEventListener('scroll', () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    });
    syncHeight();
    // When the keyboard opens, reveal the newest message above the composer.
    msgInput.addEventListener('focus', () => {
      setTimeout(() => scrollToBottom(false), 300);
    });
  })();

  // ── Service Worker ──
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

})();
