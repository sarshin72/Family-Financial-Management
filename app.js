
const SUPABASE_URL = 'https://scduywpwiqeaimmmevyn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_D7F9DCtz3dCOkbNK7e7mLw_WENkjlNc';


(function () {
  'use strict';

  /* =========================================================
     ۱. آماده‌سازی کلاینت Supabase
     ========================================================= */
  const SupabaseLib = window.supabase;
  if (!SupabaseLib) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif">خطا: کتابخانه Supabase لود نشد. اتصال اینترنت را بررسی کنید.</div>';
    return;
  }
  const supabase = SupabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage
    }
  });

  /* =========================================================
     ۲. State — تمام وضعیت برنامه در یک آبجکت
     ========================================================= */
  const state = {
    user: null,
    householdId: null,
    shareCode: '',
    config: { members: [], categories: { expense: [], income: [] } },
    transactions: [],
    shoppingList: [],
    budget: 0,
    messages: [],           // ← جدید: پیام‌های چت
    chatUnread: 0,          // ← جدید: تعداد پیام‌های خوانده‌نشده
    realtimeChannel: null,
    authMode: 'login'
  };

  /* =========================================================
     ۳. توابع تاریخ شمسی
     ========================================================= */
  const PMONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  function toJalali(gy, gm, gd) {
    const g_d_m = [0,31,59,90,120,151,181,212,243,273,304,334];
    let jy = (gy <= 1600) ? 0 : 979;
    gy -= (gy <= 1600) ? 621 : 1600;
    const gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = (365*gy) + parseInt((gy2+3)/4) - parseInt((gy2+99)/100) + parseInt((gy2+399)/400) - 80 + gd + g_d_m[gm-1];
    jy += 33 * parseInt(days/12053); days %= 12053;
    jy += 4 * parseInt(days/1461); days %= 1461;
    if (days > 365) { jy += parseInt((days-1)/365); days = (days-1)%365; }
    const jm = (days < 186) ? 1 + parseInt(days/31) : 7 + parseInt((days-186)/30);
    const jd = 1 + ((days < 186) ? (days%31) : ((days-186)%30));
    return [jy, jm, jd];
  }
  const p2 = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
  const jalaliOf = iso => { const [y,m,d] = iso.split('-').map(Number); return toJalali(y,m,d); };
  const fmtJalali = iso => { const [y,m,d] = jalaliOf(iso); return `${d} ${PMONTHS[m-1]} ${y}`; };
  const jKey = iso => { const [y,m] = jalaliOf(iso); return y + '-' + m; };
  const todayJ = () => { const n = new Date(); return toJalali(n.getFullYear(), n.getMonth()+1, n.getDate()); };

  /* =========================================================
     ۴. کمکی‌ها
     ========================================================= */
  const $ = id => document.getElementById(id);
  const fmt = n => new Intl.NumberFormat('fa-IR').format(Math.round(n || 0));
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toLatin(s){ return String(s).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))); }
  function onlyDigits(s){ return toLatin(s).replace(/[^\d]/g, ''); }

  let toastTimer;
  function toast(msg){
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  function findCat(type, id){ return (state.config.categories[type] || []).find(c => c.id === id); }
  function findMember(id){ return state.config.members.find(m => m.id === id); }

  /* =========================================================
     ۵. مدیریت Views (صفحه‌های اصلی)
     ========================================================= */
  const views = ['loadingView','loginView','appView'];
  function showView(name){
    views.forEach(v => { const el = $(v); if (el) el.style.display = 'none'; });
    const el = $(name); if (el) el.style.display = 'flex';
  }

  /* =========================================================
     ۶. احراز هویت (ورود/ثبت‌نام)
     ========================================================= */
  function setAuthMode(mode){
    state.authMode = mode;
    $('tabLogin').classList.toggle('active', mode === 'login');
    $('tabSignup').classList.toggle('active', mode === 'signup');
    $('authSubmitBtn').textContent = mode === 'login' ? 'ورود' : 'ثبت‌نام';
    $('authError').textContent = '';
  }

  // ترجمه خطاهای Supabase به فارسی
  function translateAuthError(msg){
    if (msg.includes('Invalid login credentials')) return 'ایمیل یا رمز عبور اشتباه است';
    if (msg.includes('User already registered')) return 'این ایمیل قبلاً ثبت‌نام کرده';
    if (msg.includes('Email not confirmed')) return 'ایمیل شما تأیید نشده — در تنظیمات Supabase تأیید ایمیل را غیرفعال کنید';
    if (msg.includes('Password should be at least 6')) return 'رمز عبور باید حداقل ۶ کاراکتر باشد';
    if (msg.includes('Unable to validate email')) return 'فرمت ایمیل نامعتبر است';
    if (msg.includes('network') || msg.includes('fetch')) return 'خطای شبکه — اتصال اینترنت را بررسی کنید';
    if (msg.includes('rate limit')) return 'محدودیت ارسال ایمیل — لطفاً چند دقیقه صبر کنید';
    return msg;
  }

  async function submitAuth(){
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    $('authError').textContent = '';
    if (!email || !password) { $('authError').textContent = 'ایمیل و رمز عبور را وارد کنید'; return; }
    if (password.length < 6) { $('authError').textContent = 'رمز عبور باید حداقل ۶ کاراکتر باشد'; return; }

    const btn = $('authSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'لطفاً صبر کنید...';

    try {
      if (state.authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user && !data.session) {
          $('authError').textContent = 'ثبت‌نام شد — ایمیل خود را تأیید کنید یا تأیید ایمیل را در Supabase غیرفعال کنید';
        } else {
          toast('ثبت‌نام شد ✓');
        }
      }
    } catch (err) {
      $('authError').textContent = translateAuthError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = state.authMode === 'login' ? 'ورود' : 'ثبت‌نام';
    }
  }

  async function signOut(){
    if (state.realtimeChannel) { await supabase.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
    await supabase.auth.signOut();
    state.user = null; state.householdId = null;
    state.messages = []; state.chatUnread = 0;
    showView('loginView');
  }

  /* =========================================================
     ۷. چرخه پس از ورود
     ========================================================= */
  async function afterLogin(){
    showView('loadingView');
    await loadHousehold();
    await refreshAll();
    await refreshChat();   // ← بارگذاری پیام‌های چت
    subscribeRealtime();
    showView('appView');

    const n = new Date();
    const [jy, jm, jd] = toJalali(n.getFullYear(), n.getMonth()+1, n.getDate());
    const dayNames = ['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'];
    $('todayLabel').textContent = `${dayNames[n.getDay()]}، ${jd} ${PMONTHS[jm-1]} ${jy}`;
    $('fDate').value = isoOf(n);
    renderAll(); renderSettings();
  }

  /* =========================================================
     ۸. خانوار — ساخت با RPC یا بارگذاری موجود
     ========================================================= */
  async function loadHousehold(){
    // بررسی اینکه کاربر عضو خانوار هست یا نه
    const { data: memberships, error } = await supabase
      .from('household_members').select('household_id')
      .eq('user_id', state.user.id)
      .order('joined_at', { ascending: false })
      .limit(1);

    if (error) { toast('خطا در خانوار: ' + error.message); return; }

    if (memberships && memberships.length > 0) {
      state.householdId = memberships[0].household_id;
    } else {
      // ساخت خانوار جدید از طریق RPC (دور زدن RLS برای RETURNING)
      const defaultConfig = {
        members: [{ id: 'm1', name: (state.user.email || 'من').split('@')[0] }],
        categories: {
          expense: [
            { id: 'ce1', name: 'خوراک', icon: '🍽️' },
            { id: 'ce2', name: 'پوشاک', icon: '👕' },
            { id: 'ce3', name: 'مسکن', icon: '🏠' },
            { id: 'ce4', name: 'حمل‌ونقل', icon: '🚗' },
            { id: 'ce5', name: 'درمان', icon: '💊' },
            { id: 'ce6', name: 'آموزش', icon: '📚' },
            { id: 'ce7', name: 'تفریح', icon: '🎮' },
            { id: 'ce8', name: 'قبض‌ها', icon: '🧾' },
            { id: 'ce9', name: 'هدیه', icon: '🎁' },
            { id: 'ce10', name: 'سایر', icon: '📦' }
          ],
          income: [
            { id: 'ci1', name: 'حقوق', icon: '💼' },
            { id: 'ci2', name: 'کار آزاد', icon: '🧑‍💻' },
            { id: 'ci3', name: 'سود بانکی', icon: '🏦' },
            { id: 'ci4', name: 'هدیه', icon: '🎁' },
            { id: 'ci5', name: 'سایر', icon: '📦' }
          ]
        }
      };

      const code = Math.random().toString(36).substring(2, 10).toUpperCase();

      console.log('[DEBUG] Calling RPC create_household_with_member...');
      const { data: newHhId, error: hErr } = await supabase.rpc('create_household_with_member', {
        hh_name: 'خانواده',
        hh_share_code: code,
        hh_config: defaultConfig
      });

      if (hErr) {
        console.error('[DEBUG] RPC error:', hErr);
        toast('خطا در ساخت خانوار: ' + hErr.message);
        return;
      }

      console.log('[DEBUG] Household created:', newHhId);
      state.householdId = newHhId;
      state.shareCode = code;
      state.config = defaultConfig;
      return;
    }

    // بارگذاری تنظیمات خانوار موجود
    const { data: hh, error: hhErr } = await supabase.from('households')
      .select('config, share_code').eq('id', state.householdId).single();
    if (hhErr) { toast('خطا: ' + hhErr.message); return; }
    state.shareCode = hh.share_code || '-----';
    state.config = hh.config || { members: [{ id: 'm1', name: 'من' }], categories: { expense: [], income: [] } };
  }

  /* =========================================================
     ۹. بارگذاری داده‌ها (تراکنش، خرید، بودجه، چت)
     ========================================================= */
  async function refreshTransactions(){
    if (!state.householdId) return;
    const { data, error } = await supabase.from('transactions').select('*')
      .eq('household_id', state.householdId)
      .order('date', { ascending: false }).order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    state.transactions = (data || []).map(t => ({
      id: t.id, type: t.type, amount: Number(t.amount),
      catId: t.cat_id, memberId: t.member_id, date: t.date,
      note: t.note || '', created: new Date(t.created_at).getTime()
    }));
  }

  async function refreshShopping(){
    if (!state.householdId) return;
    const { data, error } = await supabase.from('shopping_list').select('*')
      .eq('household_id', state.householdId).order('created_at', { ascending: true });
    if (error) { console.error(error); return; }
    state.shoppingList = (data || []).map(s => ({
      id: s.id, name: s.name,
      qty: Number(s.qty) || 1,
      unit: s.unit || 'عدد',
      price: Number(s.price) || 0,
      done: !!s.done,
      createdAt: new Date(s.created_at).getTime()
    }));
  }

  async function refreshBudget(){
    if (!state.householdId) return;
    const [jy, jm] = todayJ();
    const { data } = await supabase.from('budgets').select('amount')
      .eq('household_id', state.householdId).eq('month', `${jy}-${p2(jm)}`).maybeSingle();
    state.budget = data ? Number(data.amount) : 0;
  }

  async function refreshAll(){
    await Promise.all([refreshTransactions(), refreshShopping(), refreshBudget()]);
    renderAll(); renderSettings(); renderShopping();
  }

  /* =========================================================
     ۱۰. Realtime — اشتراک در تغییرات همه جداول
     ========================================================= */
  function subscribeRealtime(){
    if (!state.householdId) return;
    if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = supabase.channel('hh-' + state.householdId)
      .on('postgres_changes', { event:'*', schema:'public', table:'transactions', filter:`household_id=eq.${state.householdId}` },
          async () => { await refreshTransactions(); renderAll(); })
      .on('postgres_changes', { event:'*', schema:'public', table:'shopping_list', filter:`household_id=eq.${state.householdId}` },
          async () => { await refreshShopping(); renderShopping(); renderHome(); })
      .on('postgres_changes', { event:'*', schema:'public', table:'budgets', filter:`household_id=eq.${state.householdId}` },
          async () => { await refreshBudget(); renderHome(); })
      // ← اشتراک چت
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`household_id=eq.${state.householdId}` },
          async (payload) => {
            console.log('[CHAT] New message:', payload);
            await refreshChat();

            // اگر چت باز است → رفرش کن
            if ($('chatModal') && $('chatModal').classList.contains('open')) {
              renderChat();
              state.chatUnread = 0;
            } else if (payload.new && payload.new.user_id !== state.user.id) {
              // چت بسته → badge + toast
              state.chatUnread++;
              updateChatBadge();
              const preview = payload.new.message || '📷 عکس';
              const short = preview.length > 30 ? preview.slice(0,30) + '…' : preview;
              toast(`${payload.new.sender_name}: ${short}`);
            }
          })
      .subscribe();
  }

  /* =========================================================
     ۱۱. ناوبری و تم
     ========================================================= */
  function go(name){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('screen-' + name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'tx') renderTx();
    if (name === 'report') renderReport();
    if (name === 'settings') renderSettings();
    if (name === 'shopping') renderShopping();
  }

  function toggleTheme(){
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    $('themeBtn').textContent = isDark ? '☀️' : '🌙';
  }

  function applyTheme(){
    if (localStorage.getItem('theme') === 'dark') {
      document.body.classList.add('dark');
      $('themeBtn').textContent = '☀️';
    }
  }

  /* =========================================================
     ۱۲. رندر صفحه اصلی
     ========================================================= */
  function renderHome(){
    const [tjy, tjm] = todayJ(); const tk = tjy + '-' + tjm;
    let balance = 0, mIncome = 0, mExpense = 0;
    const catTotals = {};
    state.transactions.forEach(t => {
      if (t.type === 'income') balance += t.amount; else balance -= t.amount;
      if (jKey(t.date) === tk) {
        if (t.type === 'income') mIncome += t.amount;
        else { mExpense += t.amount; catTotals[t.catId] = (catTotals[t.catId]||0) + t.amount; }
      }
    });
    $('balAmount').textContent = fmt(balance);
    $('mIncome').textContent = fmt(mIncome);
    $('mExpense').textContent = fmt(mExpense);

    // بودجه
    if (state.budget > 0) {
      $('budgetCard').style.display = '';
      const pct = Math.min(100, (mExpense/state.budget)*100);
      $('budgetSpent').textContent = fmt(mExpense);
      $('budgetTotal').textContent = fmt(state.budget);
      const fill = $('budgetFill'); fill.style.width = pct + '%';
      fill.style.background = pct >= 100 ? 'var(--red)' : pct >= 75 ? 'var(--amber)' : 'var(--green)';
      $('budgetPct').textContent = Math.round(pct) + '٪';
    } else $('budgetCard').style.display = 'none';

    // پیش‌نمایش لیست خرید
    const shopPending = state.shoppingList.filter(i => !i.done);
    if (shopPending.length) {
      $('shopHomeCard').style.display = '';
      $('shopHomePreview').innerHTML = shopPending.slice(0,3).map(i =>
        `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px">
          <span style="width:7px;height:7px;border-radius:50%;background:var(--amber);flex-shrink:0"></span>
          <span style="flex:1">${esc(i.name)}</span>
          <span style="font-size:11px;color:var(--muted)">${fmt(i.qty)} ${esc(i.unit)}</span>
        </div>`).join('');
    } else $('shopHomeCard').style.display = 'none';

    // نمودار دسته‌بندی
    const entries = Object.entries(catTotals).sort((a,b) => b[1]-a[1]).slice(0,6);
    const maxCat = entries.length ? entries[0][1] : 1;
    $('catChart').innerHTML = entries.length
      ? entries.map(([cid,val]) => {
          const c = findCat('expense', cid);
          return `<div class="cat-row">
            <div class="cat-top"><span class="n">${c?c.icon:'📦'} ${c?esc(c.name):'سایر'}</span><span class="v">${fmt(val)}</span></div>
            <div class="cat-bar"><i style="width:${Math.max(4,(val/maxCat)*100)}%"></i></div>
          </div>`;
        }).join('')
      : `<div class="empty"><span class="em">📊</span>هنوز هزینه‌ای ثبت نشده</div>`;

    // آخرین تراکنش‌ها
    const recent = [...state.transactions].sort((a,b) => b.date.localeCompare(a.date) || b.created - a.created).slice(0,5);
    $('recentList').innerHTML = recent.length
      ? recent.map(t => txRowHTML(t, false)).join('')
      : `<div class="empty"><span class="em">🧾</span>هنوز تراکنشی ثبت نشده<br><small>با دکمه + شروع کنید</small></div>`;
  }

  function txRowHTML(t, showDelete){
    const cat = findCat(t.type, t.catId);
    const mem = findMember(t.memberId);
    const sub = [fmtJalali(t.date), mem?mem.name:'', t.note?esc(t.note):''].filter(Boolean).join(' • ');
    return `<div class="tx-row" onclick="app.openAdd('${t.id}')">
      <div class="tx-icon">${cat?cat.icon:'📦'}</div>
      <div class="tx-main"><div class="tx-title">${cat?esc(cat.name):'سایر'}</div><div class="tx-sub">${sub}</div></div>
      <div class="tx-amt ${t.type}">${t.type==='income'?'+':'−'}${fmt(t.amount)}</div>
      ${showDelete?`<button class="tx-del" onclick="event.stopPropagation();app.delTx('${t.id}')">✕</button>`:''}
    </div>`;
  }

  /* =========================================================
     ۱۳. تراکنش‌ها
     ========================================================= */
  let txTypeFilter = 'all', txMonthFilter = 'all';
  function setTxFilter(f){ txTypeFilter = f; document.querySelectorAll('#typeFilters .chip').forEach(c => c.classList.toggle('active', c.dataset.f===f)); renderTx(); }
  function setMonthFilter(k){ txMonthFilter = k; renderTx(); }

  function buildMonthFilters(){
    const now = new Date();
    let [jy, jm] = toJalali(now.getFullYear(), now.getMonth()+1, now.getDate());
    const opts = ['<button class="chip'+(txMonthFilter==='all'?' active':'')+'" onclick="app.setMonthFilter(\'all\')">همه ماه‌ها</button>'];
    for (let i=0;i<6;i++){
      let y=jy, m=jm-i;
      while (m<1){ m+=12; y--; }
      const key = y+'-'+m;
      opts.push(`<button class="chip${txMonthFilter===key?' active':''}" onclick="app.setMonthFilter('${key}')">${PMONTHS[m-1]} ${y}</button>`);
    }
    $('monthFilters').innerHTML = opts.join('');
  }

  function renderTx(){
    buildMonthFilters();
    let list = [...state.transactions];
    if (txTypeFilter !== 'all') list = list.filter(t => t.type === txTypeFilter);
    if (txMonthFilter !== 'all') list = list.filter(t => jKey(t.date) === txMonthFilter);
    list.sort((a,b) => b.date.localeCompare(a.date) || b.created - a.created);
    $('txCount').textContent = list.length ? `${fmt(list.length)} مورد` : '';
    $('txList').innerHTML = list.length
      ? list.map(t => txRowHTML(t, true)).join('')
      : `<div class="empty"><span class="em">🔍</span>تراکنشی پیدا نشد</div>`;
  }

  async function delTx(id){
    if (!confirm('این تراکنش حذف شود؟')) return;
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) return toast('خطا: ' + error.message);
    await refreshTransactions(); renderAll(); toast('حذف شد');
  }

  /* =========================================================
     ۱۴. لیست خرید
     ========================================================= */
  function renderShopping(){
    const list = state.shoppingList;
    const pending = list.filter(i => !i.done), done = list.filter(i => i.done);
    $('shopCount').textContent = list.length ? `${fmt(pending.length)} باقی‌مانده${done.length?` • ${fmt(done.length)} خریداری‌شده`:''}` : '';

    if (!list.length){
      $('shopList').innerHTML = `<div class="empty"><span class="em">🛒</span>لیست خرید خالی است</div>`;
      $('shopSummary').style.display = 'none'; return;
    }

    const renderItem = i => {
      const qty = i.qty || 1;
      const price = i.price || 0;
      const unit = i.unit || 'عدد';
      const total = qty * price;

      const chips = [
        `<span class="meta-chip">تعداد: <b>${fmt(qty)}</b> ${esc(unit)}</span>`,
        price > 0
          ? `<span class="meta-chip" onclick="app.editShopPrice('${i.id}')">قیمت واحد: <b>${fmt(price)}</b> ت</span>`
          : `<span class="meta-chip" onclick="app.editShopPrice('${i.id}')" style="color:var(--amber)">ثبت قیمت</span>`,
        price > 0
          ? `<span class="meta-chip total">جمع: <b>${fmt(total)}</b> ت</span>`
          : ''
      ].filter(Boolean).join('');

      return `<div class="shop-row${i.done?' done':''}">
        <button class="shop-check" onclick="app.toggleShopItem('${i.id}')">${i.done?'✓':''}</button>
        <div class="shop-info">
          <div class="shop-name">${esc(i.name)}</div>
          <div class="shop-meta">${chips}</div>
        </div>
        <button class="tx-del" onclick="app.delShopItem('${i.id}')" style="margin-top:4px">✕</button>
      </div>`;
    };
    let html = '';
    if (pending.length) html += `<div class="shop-divider">در انتظار (${fmt(pending.length)})</div>` + pending.map(renderItem).join('');
    if (done.length) html += `<div class="shop-divider">خریداری شده (${fmt(done.length)})</div>` + done.map(renderItem).join('');
    $('shopList').innerHTML = html;

    const dw = done.filter(i => (i.price||0) > 0);
    if (dw.length){
      const total = dw.reduce((s,i) => s + (i.qty||1)*i.price, 0);
      $('shopTotal').textContent = fmt(total) + ' تومان';
      $('shopSummary').style.display = '';
    } else $('shopSummary').style.display = 'none';
  }

  async function addShoppingItem(){
    const nameEl = $('shopName');
    const name = nameEl.value.trim();
    if (!name) return toast('نام کالا را وارد کنید');
    if (!state.householdId) return toast('خانوار بارگذاری نشده — دوباره وارد شوید');
    const qty = Math.max(1, parseInt(onlyDigits($('shopQty').value),10)||1);
    const unit = ($('shopUnit').value.trim() || 'عدد');
    const price = Math.max(0, parseInt(onlyDigits($('shopPrice').value),10)||0);

    const { error } = await supabase.from('shopping_list').insert({
      household_id: state.householdId, name, qty, unit, price, done: false, created_by: state.user.id
    });
    if (error) return toast('خطا: ' + error.message);

    nameEl.value = ''; $('shopQty').value = '1'; $('shopUnit').value = 'عدد'; $('shopPrice').value = '';
    nameEl.focus();
    await refreshShopping(); renderShopping(); renderHome();
    toast('اضافه شد');
  }

  async function toggleShopItem(id){
    const item = state.shoppingList.find(i => i.id === id);
    if (!item) return;
    const { error } = await supabase.from('shopping_list').update({ done: !item.done }).eq('id', id);
    if (error) return toast('خطا: ' + error.message);
    await refreshShopping(); renderShopping(); renderHome();
  }

  async function delShopItem(id){
    const { error } = await supabase.from('shopping_list').delete().eq('id', id);
    if (error) return toast('خطا: ' + error.message);
    await refreshShopping(); renderShopping(); renderHome();
  }

  async function editShopPrice(id){
    const item = state.shoppingList.find(i => i.id === id);
    if (!item) return;
    const v = prompt('قیمت واحد (تومان):', item.price ? String(item.price) : '');
    if (v === null) return;
    const price = parseInt(onlyDigits(v),10) || 0;
    const { error } = await supabase.from('shopping_list').update({ price }).eq('id', id);
    if (error) return toast('خطا: ' + error.message);
    await refreshShopping(); renderShopping();
  }

  async function clearDoneShopping(){
    const done = state.shoppingList.filter(i => i.done);
    if (!done.length) return toast('خریداری‌شده‌ای نیست');
    if (!confirm(`${fmt(done.length)} کالا حذف شود؟`)) return;
    const ids = done.map(i => i.id);
    const { error } = await supabase.from('shopping_list').delete().in('id', ids);
    if (error) return toast('خطا: ' + error.message);
    await refreshShopping(); renderShopping(); renderHome(); toast('پاک شد');
  }

  async function clearAllShopping(){
    if (!state.shoppingList.length) return toast('لیست خالی است');
    if (!confirm('کل لیست پاک شود؟')) return;
    const { error } = await supabase.from('shopping_list').delete().eq('household_id', state.householdId);
    if (error) return toast('خطا: ' + error.message);
    await refreshShopping(); renderShopping(); renderHome(); toast('پاک شد');
  }

  async function shoppingToExpense(){
    const done = state.shoppingList.filter(i => i.done && (i.price||0) > 0);
    if (!done.length) return toast('کالای خریداری‌شده با قیمت نیست');
    const total = done.reduce((s,i) => s + (i.qty||1)*i.price, 0);
    if (!confirm(`${fmt(total)} تومان به هزینه‌ها اضافه شود؟`)) return;
    const catId = state.config.categories.expense[0]?.id;
    const memberId = state.config.members[0]?.id;
    const names = done.map(i => i.name).join('، ');
    const note = 'خرید: ' + (names.length > 45 ? names.slice(0,45)+'…' : names);
    const { error } = await supabase.from('transactions').insert({
      household_id: state.householdId, type:'expense', amount: total,
      cat_id: catId, member_id: memberId, date: isoOf(new Date()), note, created_by: state.user.id
    });
    if (error) return toast('خطا: ' + error.message);
    await supabase.from('shopping_list').delete().in('id', done.map(i => i.id));
    await refreshTransactions(); await refreshShopping(); renderAll(); renderShopping();
    toast(`${fmt(total)} تومان ثبت شد ✓`);
  }

  /* =========================================================
     ۱۵. گزارش
     ========================================================= */
  function renderReport(){
    const now = new Date();
    let [tjy, tjm] = toJalali(now.getFullYear(), now.getMonth()+1, now.getDate());
    const months = [];
    for (let i=5;i>=0;i--){ let y=tjy, m=tjm-i; while(m<1){m+=12;y--;} months.push([y,m]); }
    const map = {};
    state.transactions.forEach(t => {
      const k = jKey(t.date);
      if (!map[k]) map[k] = { inc: 0, exp: 0 };
      if (t.type === 'income') map[k].inc += t.amount; else map[k].exp += t.amount;
    });
    let max = 1;
    months.forEach(([y,m]) => { const d = map[y+'-'+m]||{inc:0,exp:0}; max = Math.max(max, d.inc, d.exp); });
    $('monthBars').innerHTML = months.map(([y,m]) => {
      const d = map[y+'-'+m] || { inc:0, exp:0 };
      return `<div class="bar-group"><div class="bar-wrap">
        <div class="bar i" style="height:${Math.max(2,Math.round((d.inc/max)*100))}%" title="${fmt(d.inc)}"></div>
        <div class="bar e" style="height:${Math.max(2,Math.round((d.exp/max)*100))}%" title="${fmt(d.exp)}"></div>
      </div><div class="bar-label">${PMONTHS[m-1].slice(0,4)}</div></div>`;
    }).join('');

    const tk = tjy + '-' + tjm;
    $('repMonth').textContent = `${PMONTHS[tjm-1]} ${tjy}`;
    const catTotals = {}; let monthExpTotal = 0;
    state.transactions.forEach(t => {
      if (t.type === 'expense' && jKey(t.date) === tk) { catTotals[t.catId] = (catTotals[t.catId]||0) + t.amount; monthExpTotal += t.amount; }
    });
    const cEntries = Object.entries(catTotals).sort((a,b) => b[1]-a[1]);
    const maxC = cEntries.length ? cEntries[0][1] : 1;
    $('repCats').innerHTML = cEntries.length
      ? cEntries.map(([cid,val]) => {
          const c = findCat('expense', cid);
          const pct = monthExpTotal ? Math.round((val/monthExpTotal)*100) : 0;
          return `<div class="cat-row">
            <div class="cat-top"><span class="n">${c?c.icon:'📦'} ${c?esc(c.name):'سایر'}</span><span class="v">${fmt(val)} <small style="opacity:.6">(${pct}٪)</small></span></div>
            <div class="cat-bar"><i style="width:${Math.max(3,(val/maxC)*100)}%"></i></div>
          </div>`;
        }).join('')
      : `<div class="empty"><span class="em">📉</span>داده‌ای نیست</div>`;

    const memTotals = {};
    state.transactions.forEach(t => {
      if (t.type === 'expense' && jKey(t.date) === tk) memTotals[t.memberId] = (memTotals[t.memberId]||0) + t.amount;
    });
    const mEntries = Object.entries(memTotals).sort((a,b) => b[1]-a[1]);
    const maxM = mEntries.length ? mEntries[0][1] : 1;
    $('repMembers').innerHTML = mEntries.length
      ? mEntries.map(([mid,val]) => {
          const m = findMember(mid);
          const pct = monthExpTotal ? Math.round((val/monthExpTotal)*100) : 0;
          return `<div class="cat-row">
            <div class="cat-top"><span class="n">👤 ${m?esc(m.name):'نامشخص'}</span><span class="v">${fmt(val)} <small style="opacity:.6">(${pct}٪)</small></span></div>
            <div class="cat-bar"><i style="width:${Math.max(3,(val/maxM)*100)}%"></i></div>
          </div>`;
        }).join('')
      : `<div class="empty"><span class="em">👨‍👩‍👧</span>داده‌ای نیست</div>`;
  }

  /* =========================================================
     ۱۶. تنظیمات
     ========================================================= */
  function renderSettings(){
    $('shareCodeDisplay').value = state.shareCode || '-----';
    const bi = $('budgetInput');
    if (document.activeElement !== bi) bi.value = state.budget > 0 ? String(state.budget) : '';
    $('memberList').innerHTML = state.config.members.map(m => `
      <div class="set-row"><div class="nm"><span class="em">👤</span>${esc(m.name)}</div>
      ${state.config.members.length>1?`<button class="del" onclick="app.delMember('${m.id}')">✕</button>`:''}</div>
    `).join('') || `<div class="empty">عضوی نیست</div>`;
    const catHTML = type => (state.config.categories[type]||[]).map(c => `
      <div class="set-row"><div class="nm"><span class="em">${c.icon}</span>${esc(c.name)}</div>
      <button class="del" onclick="app.delCat('${type}','${c.id}')">✕</button></div>
    `).join('') || `<div class="empty">دسته‌ای نیست</div>`;
    $('expCatList').innerHTML = catHTML('expense');
    $('incCatList').innerHTML = catHTML('income');
  }

  async function saveConfigToCloud(){
    const { error } = await supabase.from('households').update({ config: state.config }).eq('id', state.householdId);
    if (error) toast('خطا در ذخیره: ' + error.message);
  }

  async function saveBudget(){
    const v = parseInt(onlyDigits($('budgetInput').value),10) || 0;
    if (v <= 0) return toast('مبلغ بودجه را وارد کنید');
    const [jy, jm] = todayJ();
    const { error } = await supabase.from('budgets').upsert({
      household_id: state.householdId, amount: v, month: `${jy}-${p2(jm)}`
    }, { onConflict: 'household_id,month' });
    if (error) return toast('خطا: ' + error.message);
    state.budget = v; renderHome(); toast('بودجه ثبت شد');
  }

  async function addMember(){
    const inp = $('newMember'); const name = inp.value.trim();
    if (!name) return toast('نام را وارد کنید');
    state.config.members.push({ id: 'm'+Date.now(), name });
    inp.value = '';
    await saveConfigToCloud(); renderSettings(); renderAll(); toast('اضافه شد');
  }

  async function delMember(id){
    if (state.config.members.length <= 1) return;
    if (!confirm('این عضو حذف شود؟')) return;
    state.config.members = state.config.members.filter(m => m.id !== id);
    await saveConfigToCloud(); renderSettings(); renderAll();
  }

  async function addCat(type){
    const isExp = type === 'expense';
    const nameInp = $(isExp?'newExpCat':'newIncCat');
    const emInp = $(isExp?'newExpCatEmoji':'newIncCatEmoji');
    const name = nameInp.value.trim();
    if (!name) return toast('نام دسته را وارد کنید');
    state.config.categories[type].push({ id: (isExp?'ce':'ci')+Date.now(), name, icon: emInp.value.trim() || (isExp?'📦':'💰') });
    nameInp.value = ''; emInp.value = '';
    await saveConfigToCloud(); renderSettings(); renderAll(); toast('اضافه شد');
  }

  async function delCat(type, id){
    if (!confirm('این دسته حذف شود؟')) return;
    state.config.categories[type] = state.config.categories[type].filter(c => c.id !== id);
    await saveConfigToCloud(); renderSettings(); renderAll();
  }

  /* =========================================================
     ۱۷. کد اشتراک و پیوستن به خانوار
     ========================================================= */
  async function copyShareCode(){
    try { await navigator.clipboard.writeText(state.shareCode); toast('کد کپی شد ✓'); }
    catch {
      const inp = $('shareCodeDisplay'); inp.select();
      document.execCommand('copy'); toast('کد کپی شد ✓');
    }
  }

  // پیوستن با کد — مستقیماً state.householdId را از RPC تنظیم می‌کند
  async function joinHousehold(){
    const code = $('joinCodeInput').value.trim().toUpperCase();
    if (!code) return toast('کد را وارد کنید');
    if (!confirm('با پیوستن، از خانوار قبلی جدا می‌شوید و داده‌های خانوار جدید را می‌بینید. ادامه؟')) return;

    console.log('[DEBUG] Joining household with code:', code);
    const { data: newHhId, error } = await supabase.rpc('join_household_by_code', { code_input: code });

    if (error) {
      console.error('[DEBUG] Join error:', error);
      return toast('کد نامعتبر: ' + error.message);
    }

    console.log('[DEBUG] Joined household:', newHhId);

    // مهم: مستقیماً شناسه جدید را تنظیم کن (نه از loadHousehold)
    state.householdId = newHhId;

    // بارگذاری تنظیمات خانوار جدید
    const { data: hh, error: hhErr } = await supabase.from('households')
      .select('config, share_code').eq('id', newHhId).single();

    if (!hhErr && hh) {
      state.shareCode = hh.share_code || '-----';
      state.config = hh.config || { members: [{ id: 'm1', name: 'من' }], categories: { expense: [], income: [] } };
    }

    $('joinCodeInput').value = '';

    // رفرش داده‌ها با householdId جدید
    await refreshAll();
    await refreshChat();
    if (state.realtimeChannel) await supabase.removeChannel(state.realtimeChannel);
    subscribeRealtime();
    renderAll(); renderSettings(); renderShopping();
    toast('پیوستید ✓');
  }

  /* =========================================================
     ۱۸. چت — بارگذاری، رندر، ارسال، آپلود عکس
     ========================================================= */

  // فرمت ساعت پیام (۱۴:۳۰)
  function formatChatTime(iso) {
    const d = new Date(iso);
    return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  // فرمت تاریخ پیام (امروز / دیروز / تاریخ شمسی)
  function formatChatDate(iso) {
    const n = new Date();
    const msgDate = isoOf(new Date(iso));
    const today = isoOf(n);
    const yd = new Date(n); yd.setDate(yd.getDate() - 1);
    if (msgDate === today) return 'امروز';
    if (msgDate === isoOf(yd)) return 'دیروز';
    return fmtJalali(msgDate);
  }

  // بارگذاری ۳۰۰ پیام آخر از Supabase
  async function refreshChat() {
    if (!state.householdId) return;
    const { data, error } = await supabase.from('chat_messages').select('*')
      .eq('household_id', state.householdId)
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) { console.error(error); return; }
    state.messages = (data || []).map(m => ({
      id: m.id,
      userId: m.user_id,
      senderName: m.sender_name,
      message: m.message || '',
      attachmentUrl: m.attachment_url || null,
      attachmentType: m.attachment_type || null,
      createdAt: m.created_at,
      time: new Date(m.created_at).getTime()
    }));
  }

  // رندر پیام‌ها با پشتیبانی از عکس
  function renderChat() {
    const container = $('chatMessages');
    if (!container) return;
    const list = state.messages || [];
    if (!list.length) {
      container.innerHTML = `<div class="empty"><span class="em">💬</span>هنوز پیامی نیست<br><small>اولین پیام را بفرستید</small></div>`;
      return;
    }
    let html = '';
    let lastDate = '';
    list.forEach(m => {
      // جداکننده تاریخ
      const msgDate = isoOf(new Date(m.createdAt));
      if (msgDate !== lastDate) {
        html += `<div class="chat-date-sep">${formatChatDate(m.createdAt)}</div>`;
        lastDate = msgDate;
      }

      const isOwn = m.userId === state.user.id;

      // محتوای حباب: اگر عکس دارد، عکس + متن (اختیاری)
      let bubbleContent = '';
      if (m.attachmentUrl) {
        bubbleContent += `<img src="${esc(m.attachmentUrl)}" loading="lazy" alt="عکس" onclick="app.openLightbox(this.src)">`;
      }
      if (m.message) {
        bubbleContent += m.attachmentUrl
          ? `<div style="margin-top:6px">${esc(m.message)}</div>`
          : esc(m.message);
      }
      if (!bubbleContent) bubbleContent = '—';

      html += `<div class="msg ${isOwn ? 'own' : 'other'}">
        ${!isOwn ? `<div class="msg-sender">${esc(m.senderName)}</div>` : ''}
        <div class="msg-bubble">${bubbleContent}</div>
        <div class="msg-time">${formatChatTime(m.createdAt)}</div>
      </div>`;
    });
    container.innerHTML = html;
    // اسکرول به انتها
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }

  // ارسال پیام متنی
  async function sendChatMessage() {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    if (!state.householdId) return toast('خانوار بارگذاری نشده');

    const senderName = (state.user.email || 'کاربر').split('@')[0];
    input.value = '';
    input.style.height = 'auto';

    const { error } = await supabase.from('chat_messages').insert({
      household_id: state.householdId,
      user_id: state.user.id,
      sender_name: senderName,
      message: text
    });

    if (error) {
      toast('خطا: ' + error.message);
      input.value = text;
      return;
    }

    await refreshChat();
    renderChat();
    state.chatUnread = 0;
    updateChatBadge();
  }

  // آپلود عکس — Edge Function → presigned URL → ArvanCloud
  async function uploadChatImage(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('فقط عکس مجاز است');
    if (file.size > 5 * 1024 * 1024) return toast('حجم عکس باید کمتر از ۵ مگابایت باشد');
    if (!state.householdId) return toast('خانوار بارگذاری نشده');

    const input = $('chatInput');
    const caption = input.value.trim();
    const sendBtn = $('chatSendBtn');
    const attachBtn = document.querySelector('.chat-attach-btn');

    // غیرفعال کردن دکمه‌ها در حین آپلود
    sendBtn.disabled = true;
    if (attachBtn) attachBtn.disabled = true;
    toast('در حال آپلود عکس...');

    try {
      // ۱. گرفتن presigned URL از Edge Function
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
 `${SUPABASE_URL}/functions/v1/smooth-task-v2`,  
  {
    method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ fileName: file.name, contentType: file.type }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const { uploadUrl, publicUrl } = await res.json();

      // ۲. آپلود مستقیم به ArvanCloud
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error(`آپلود به آروان ناموفق: ${uploadRes.status}`);
      }

      // ۳. ثبت پیام در Supabase
      const senderName = (state.user.email || 'کاربر').split('@')[0];
      const { error } = await supabase.from('chat_messages').insert({
        household_id: state.householdId,
        user_id: state.user.id,
        sender_name: senderName,
        message: caption,
        attachment_url: publicUrl,
        attachment_type: 'image',
      });

      if (error) throw error;

      input.value = '';
      input.style.height = 'auto';
      await refreshChat();
      renderChat();
      toast('عکس ارسال شد ✓');
    } catch (err) {
      console.error('[UPLOAD]', err);
      toast('خطا: ' + err.message);
    } finally {
      sendBtn.disabled = false;
      if (attachBtn) attachBtn.disabled = false;
      const fileInput = $('chatFileInput');
      if (fileInput) fileInput.value = '';
    }
  }

  // به‌روزرسانی badge پیام‌های خوانده‌نشده
  function updateChatBadge() {
    const badge = $('chatBadge');
    if (!badge) return;
    if (state.chatUnread > 0) {
      badge.textContent = state.chatUnread > 99 ? '99+' : String(state.chatUnread);
      badge.style.display = 'grid';
    } else {
      badge.style.display = 'none';
    }
  }

  // باز کردن مودال چت
  async function openChat() {
    $('chatModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    await refreshChat();
    renderChat();
    state.chatUnread = 0;
    updateChatBadge();
    setTimeout(() => $('chatInput').focus(), 320);
  }

  // بستن مودال چت
  function closeChat() {
    $('chatModal').classList.remove('open');
    document.body.style.overflow = '';
  }

  // لایت‌باکس عکس
  function openLightbox(url) {
    const lb = $('lightbox');
    const img = $('lightboxImg');
    if (!lb || !img) return;
    img.src = url;
    lb.classList.add('open');
  }

  function closeLightbox() {
    const lb = $('lightbox');
    if (!lb) return;
    lb.classList.remove('open');
    $('lightboxImg').src = '';
  }

  /* =========================================================
     ۱۹. مودال تراکنش
     ========================================================= */
  let formType = 'expense', formCat = null, formMember = null, editId = null;
  function openAdd(id){
    editId = id || null;
    const t = id ? state.transactions.find(x => x.id === id) : null;
    formType = t ? t.type : 'expense';
    formCat = t ? t.catId : null;
    formMember = t ? t.memberId : (state.config.members[0]?.id || null);
    $('sheetTitle').textContent = t ? 'ویرایش' : 'تراکنش جدید';
    $('fAmount').value = t ? String(t.amount) : '';
    $('fNote').value = t ? (t.note||'') : '';
    $('fDate').value = t ? t.date : isoOf(new Date());
    updateTypeUI(); renderCatChips(); renderMemberChips();
    updateAmountPreview(); updateDateLabel();
    $('addModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeAdd(){ $('addModal').classList.remove('open'); document.body.style.overflow = ''; }
  function setType(t){ formType = t; formCat = null; updateTypeUI(); renderCatChips(); }
  function updateTypeUI(){
    const isExp = formType === 'expense';
    $('btnTypeExpense').classList.toggle('active', isExp);
    $('btnTypeIncome').classList.toggle('active', !isExp);
  }
  function renderCatChips(){
    const cats = state.config.categories[formType] || [];
    if (!cats.find(c => c.id === formCat)) formCat = cats[0]?.id || null;
    $('catChips').innerHTML = cats.length
      ? cats.map(c => `<button class="chip${c.id===formCat?' active':''}" onclick="app.pickCat('${c.id}')">${c.icon} ${esc(c.name)}</button>`).join('')
      : `<span style="font-size:12px;color:var(--muted)">دسته‌ای تعریف نشده</span>`;
  }
  function pickCat(id){ formCat = id; renderCatChips(); }
  function renderMemberChips(){
    if (!state.config.members.find(m => m.id === formMember)) formMember = state.config.members[0]?.id || null;
    $('memberChips').innerHTML = state.config.members.map(m =>
      `<button class="chip${m.id===formMember?' active':''}" onclick="app.pickMember('${m.id}')">👤 ${esc(m.name)}</button>`
    ).join('');
  }
  function pickMember(id){ formMember = id; renderMemberChips(); }
  function updateAmountPreview(){
    const v = parseInt(onlyDigits($('fAmount').value),10) || 0;
    $('amountPreview').textContent = v > 0 ? fmt(v) + ' تومان' : '';
  }
  function updateDateLabel(){
    const v = $('fDate').value;
    $('dateJalali').textContent = v ? fmtJalali(v) : '';
  }
  async function saveTx(){
    const amount = parseInt(onlyDigits($('fAmount').value),10) || 0;
    if (amount <= 0) return toast('مبلغ را وارد کنید');
    if (!formCat) return toast('یک دسته انتخاب کنید');
    const date = $('fDate').value || isoOf(new Date());
    const note = $('fNote').value.trim();
    if (editId){
      const { error } = await supabase.from('transactions').update({
        type: formType, amount, cat_id: formCat, member_id: formMember, date, note,
        updated_at: new Date().toISOString()
      }).eq('id', editId);
      if (error) return toast('خطا: ' + error.message);
    } else {
      const { error } = await supabase.from('transactions').insert({
        household_id: state.householdId, type: formType, amount,
        cat_id: formCat, member_id: formMember, date, note, created_by: state.user.id
      });
      if (error) return toast('خطا: ' + error.message);
    }
    await refreshTransactions(); closeAdd(); renderAll();
    toast(editId ? 'ویرایش شد ✓' : 'ثبت شد ✓');
  }

  /* =========================================================
     ۲۰. رندر کلی
     ========================================================= */
  function renderAll(){
    renderHome(); renderTx(); renderReport(); renderShopping();
    // اگر چت باز است، رفرش کن
    if ($('chatModal') && $('chatModal').classList.contains('open')) renderChat();
    updateChatBadge();
  }

  /* =========================================================
     ۲۱. اتصال رویدادها
     ========================================================= */
  function bindEvents(){
    // Auth
    $('tabLogin').addEventListener('click', () => setAuthMode('login'));
    $('tabSignup').addEventListener('click', () => setAuthMode('signup'));
    $('authSubmitBtn').addEventListener('click', submitAuth);
    $('authPassword').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
    $('authEmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('authPassword').focus(); });

    // ورودی‌های عددی
    $('fAmount').addEventListener('input', e => { e.target.value = onlyDigits(e.target.value); updateAmountPreview(); });
    $('fDate').addEventListener('change', updateDateLabel);
    $('shopPrice').addEventListener('input', e => e.target.value = onlyDigits(e.target.value));
    $('shopQty').addEventListener('input', e => e.target.value = onlyDigits(e.target.value));
    $('shopName').addEventListener('keydown', e => { if (e.key === 'Enter') addShoppingItem(); });
    $('shopPrice').addEventListener('keydown', e => { if (e.key === 'Enter') addShoppingItem(); });

    // مودال تراکنش — بستن با کلیک روی پس‌زمینه
    $('addModal').addEventListener('click', e => { if (e.target === $('addModal')) closeAdd(); });

    // ===== چت =====
    $('chatSendBtn').addEventListener('click', sendChatMessage);

    // ارسال با Enter (و shift+Enter برای خط جدید)
    $('chatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    // Auto-resize textarea
    $('chatInput').addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });

    // انتخاب فایل برای آپلود
    $('chatFileInput').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) uploadChatImage(file);
    });

    // بستن چت با کلیک روی پس‌زمینه
    $('chatModal').addEventListener('click', e => {
      if (e.target === $('chatModal')) closeChat();
    });

    // بستن لایت‌باکس با ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if ($('lightbox')?.classList.contains('open')) closeLightbox();
        else if ($('chatModal')?.classList.contains('open')) closeChat();
      }
    });

    // جلوگیری از زوم دو انگشتی
    document.addEventListener('gesturestart', e => e.preventDefault());
  }

  /* =========================================================
     ۲۲. API عمومی (برای onclick در HTML)
     ========================================================= */
  window.app = {
    go, toggleTheme, signOut,
    setTxFilter, setMonthFilter,
    openAdd, closeAdd, setType, pickCat, pickMember, saveTx, delTx,
    addShoppingItem, toggleShopItem, delShopItem, editShopPrice,
    clearDoneShopping, clearAllShopping, shoppingToExpense,
    saveBudget, addMember, delMember, addCat, delCat,
    copyShareCode, joinHousehold,
    // چت
    openChat, closeChat, sendChatMessage, uploadChatImage,
    openLightbox, closeLightbox
  };

  /* =========================================================
     ۲۳. شروع برنامه
     ========================================================= */
  (async function start(){
    applyTheme();
    bindEvents();
    $('fDate').value = isoOf(new Date());

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      state.user = session.user;
      await afterLogin();
    } else {
      showView('loginView');
    }

    // گوش دادن به تغییرات auth
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        state.user = session.user;
        await afterLogin();
      } else if (event === 'SIGNED_OUT') {
        state.user = null; state.householdId = null;
        state.messages = []; state.chatUnread = 0;
        showView('loginView');
      }
    });
  })();

})();
