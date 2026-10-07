(() => {
  'use strict';

  // 預設分鐘數；所有模式均以毫秒計時，畫面顯示時才換算為秒。
  const DEFAULTS = Object.freeze({ focus: 25, short: 5, long: 15 });
  const STORAGE_KEY = 'quiet-pomodoro-settings-v1';
  const LABELS = { focus: '專注', short: '短休息', long: '長休息' };
  const $ = id => document.getElementById(id);
  let storageAvailable = true;
  let durations = loadSettings();
  let mode = 'focus';
  let completed = 0;
  let remaining = durations.focus * 60000;
  let phaseDuration = remaining;
  let running = false;
  let deadline = 0;
  let audioContext = null;
  let registration = null;

  function validMinutes(value) {
    return Number.isInteger(value) && value >= 1 && value <= 180;
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Object.keys(DEFAULTS).every(key => validMinutes(saved[key]))) {
        return { focus: saved.focus, short: saved.short, long: saved.long };
      }
    } catch (_) {
      // JSON 損壞、隱私模式或儲存被停用時，仍可用預設時間計時。
      storageAvailable = false;
    }
    return { ...DEFAULTS };
  }

  function announce(message) { $('status').textContent = message; }

  function nextMode() {
    return mode === 'focus' ? (completed >= 3 ? 'long' : 'short') : 'focus';
  }

  function render() {
    const seconds = Math.ceil(Math.max(0, remaining) / 1000);
    const minutes = Math.floor(seconds / 60);
    const tail = seconds % 60;
    const text = `${String(minutes).padStart(2, '0')}:${String(tail).padStart(2, '0')}`;
    $('timer').textContent = text;
    $('timer').setAttribute('aria-label', `剩餘 ${minutes} 分 ${tail} 秒`);
    document.title = `${text}｜${mode === 'focus' ? '專注' : '休息'}`;
    document.body.dataset.mode = mode;
    $('toggle').textContent = running ? '暫停' : (remaining < phaseDuration ? '繼續' : '開始');
    $('timer-state').textContent = running ? `${LABELS[mode]}中` : (remaining < phaseDuration ? '已暫停' : '準備開始');
    $('phase-label').textContent = mode === 'focus' ? '留一段時間，給眼前的事。' : '放鬆一下，讓思緒留白。';
    $('rounds').textContent = `${completed} / 4`;
    document.querySelectorAll('[data-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
    [...$('cycle-dots').children].forEach((dot, index) => dot.classList.toggle('done', index < completed));
    const next = nextMode();
    $('next-phase').textContent = `下一段 · ${LABELS[next]} ${durations[next]} 分鐘`;
  }

  function enterMode(next, shouldRun = false, now = Date.now()) {
    mode = next;
    remaining = durations[mode] * 60000;
    phaseDuration = remaining;
    running = shouldRun;
    deadline = shouldRun ? now + remaining : 0;
    render();
  }

  // 僅自然完成專注才累計輪數，跳過不算；長休息結束重開循環。
  function advance(natural, now = Date.now()) {
    const finished = mode;
    const continueRunning = running;
    let next;
    if (mode === 'focus') {
      if (natural) completed = Math.min(4, completed + 1);
      next = completed >= 4 ? 'long' : 'short';
    } else {
      if (mode === 'long') completed = 0;
      next = 'focus';
    }
    // 背景恢復時只結算目前階段，不虛增離開期間的完成輪數。
    enterMode(next, continueRunning, now);
    if (natural) {
      const title = finished === 'focus' ? '專注完成' : '休息結束';
      const body = finished === 'focus' ? '休息一下吧。' : '準備開始下一輪專注。';
      announce(`${title}。${body}已開始${LABELS[next]}。`);
      playChime();
      void notify(title, body);
    } else {
      announce(`已跳過${LABELS[finished]}，${LABELS[next]}${running ? '已開始' : '準備就緒'}。`);
    }
  }

  // interval 只負責刷新；不逐秒相減，避免分頁節流造成累積誤差。
  function tick(now = Date.now()) {
    if (!running) return false;
    remaining = Math.max(0, deadline - now);
    if (remaining === 0) {
      advance(true, now);
      return true;
    }
    render();
    return false;
  }

  // 必須在使用者點擊事件中建立／恢復 AudioContext，不能等到到時才初始化。
  function unlockAudio() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!audioContext || audioContext.state === 'closed') audioContext = new Audio();
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      const buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => source.disconnect();
      source.start();
    } catch (_) { /* 音訊不可用時，倒數與畫面提示仍繼續。 */ }
  }

  function playChime() {
    if (!audioContext || audioContext.state !== 'running') return;
    try {
      // 兩個低音量正弦音，淡入淡出避免爆音。
      [440, 554.37].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = audioContext.currentTime + index * 0.32;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.075, start + 0.045);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.65);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.7);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    } catch (_) { /* 部分手機恢復背景時會暫停音訊，保留視覺提示。 */ }
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const notificationsSupported = () => window.isSecureContext && 'Notification' in window && !(isIOS && !standalone());

  function updateNotificationUI() {
    const button = $('notifications');
    const hint = $('notification-status');
    if (!notificationsSupported()) {
      button.disabled = true;
      button.textContent = '此環境不支援通知';
      hint.textContent = '時間到時仍顯示畫面提醒，並在音訊允許時播放提示音。請使用 HTTPS；iPhone 請先加入主畫面。';
      return;
    }
    const permission = Notification.permission;
    button.disabled = permission !== 'default';
    button.textContent = permission === 'granted' ? '通知已開啟' : permission === 'denied' ? '通知已被封鎖' : '開啟通知';
    hint.textContent = permission === 'granted'
      ? '已授權；系統休眠或網頁在背景被暫停時，仍無法保證準時通知。'
      : permission === 'denied'
        ? '可至瀏覽器或系統的網站通知設定重新允許。計時與畫面提醒不受影響。'
        : '僅在你按下按鈕後要求授權；背景或鎖屏提醒受系統限制。';
  }

  async function notify(title, body) {
    if (!notificationsSupported() || Notification.permission !== 'granted') return;
    const options = { body, tag: 'pomodoro-phase', icon: './icons/icon-192.png', silent: true };
    try {
      if (registration?.active && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, options);
      } else {
        const notice = new Notification(title, options);
        notice.onclick = () => { window.focus(); notice.close(); };
      }
    } catch (_) {
      // 行動版可能拒絕 Notification 建構子或無 Push 訂閱的通知，不影響計時。
      $('notification-status').textContent = '此環境目前無法顯示系統通知；仍保留畫面提醒與可用的提示音。';
    }
  }

  $('toggle').addEventListener('click', () => {
    unlockAudio();
    const now = Date.now();
    if (running) {
      tick(now);
      running = false;
      deadline = 0;
      announce('已暫停。');
    } else {
      running = true;
      deadline = now + remaining;
      announce('');
    }
    render();
  });
  $('reset').addEventListener('click', () => {
    enterMode(mode);
    announce(`已重設${LABELS[mode]}時間，完成輪數保留。`);
  });
  $('skip').addEventListener('click', () => {
    unlockAudio();
    // 若剛好已到時，只結算一次，避免一次點擊連跳兩個階段。
    if (!tick()) advance(false);
  });
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      if (mode === button.dataset.mode) return;
      enterMode(button.dataset.mode);
      announce(`已切換為${LABELS[mode]}，按開始計時。`);
    });
  });

  $('settings-open').addEventListener('click', () => {
    Object.keys(DEFAULTS).forEach(key => { $(`${key}-minutes`).value = durations[key]; });
    $('ios-help').hidden = !(isIOS && !standalone());
    updateNotificationUI();
    $('settings').showModal();
  });
  $('settings-close').addEventListener('click', () => $('settings').close());
  $('settings').addEventListener('click', event => {
    if (event.target !== $('settings')) return;
    const rect = $('settings').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('settings').close();
  });
  $('settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const updated = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, Number($(`${key}-minutes`).value)]));
    if (!Object.values(updated).every(validMinutes)) return;
    durations = updated;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(durations));
      storageAvailable = true;
    } catch (_) { storageAvailable = false; }
    // 未開始的階段立即套用；已開始或暫停的階段保持原本剩餘時間。
    if (!running && remaining === phaseDuration) enterMode(mode);
    else render();
    $('settings').close();
    announce(storageAvailable ? '時間已儲存。進行中的階段保持不變，下一段或重設時套用。' : '已套用時間，但瀏覽器無法儲存；關閉後設定將不會保留。');
  });
  $('notifications').addEventListener('click', async () => {
    if (!notificationsSupported()) return;
    try {
      // 直接在按鈕事件中要求權限，不先等待 SW 或其他非同步工作。
      await Notification.requestPermission();
      updateNotificationUI();
    } catch (_) {
      $('notification-status').textContent = '此環境無法要求通知授權；畫面提醒與可用的提示音仍會運作。';
    }
  });

  // 僅 HTTPS 或 localhost 可註冊 SW。離線狀態顯示的是快取是否已就緒。
  function updateOfflineStatus() {
    $('offline-status').textContent = registration?.active ? '已可離線使用' : '正在準備離線使用';
  }
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      $('offline-status').textContent = '一般網頁模式 · 離線需 HTTPS';
      return;
    }
    try {
      registration = await navigator.serviceWorker.register('./service-worker.js');
      updateOfflineStatus();
      navigator.serviceWorker.ready.then(ready => { registration = ready; updateOfflineStatus(); });
      navigator.serviceWorker.addEventListener('controllerchange', updateOfflineStatus);
    } catch (_) {
      $('offline-status').textContent = '離線準備失敗 · 仍可線上使用';
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { tick(); updateNotificationUI(); }
  });
  window.addEventListener('pageshow', () => tick());
  window.addEventListener('focus', () => { tick(); updateNotificationUI(); });
  setInterval(() => tick(), 250);
  render();
  updateNotificationUI();
  if (!storageAvailable) announce('目前使用預設時間；瀏覽器中的設定無法讀取。');
  void registerServiceWorker();
})();
