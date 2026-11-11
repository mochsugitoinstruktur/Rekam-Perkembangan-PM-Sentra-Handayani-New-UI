const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyDOUCYVo38JnkgJcbbwb6ergsTDbt-VpRH5e0t3FUWoEfL6ssBPUvce3Z8I9bCmLxw/exec";

let dataPM = [];
let dataPegawai = [];
let dataPerkembangan = [];
let systemLogs = [];

let usersDB = {};
let pwdRequests = [];
let currentUser = null;

let chartKasusInstance = null;
let chartVokasionalInstance = null;

let KASUS_DEFAULTS = [];
let VOKASIONAL_DEFAULTS = [];
let ASRAMA_DEFAULTS = [];
let JABATAN_DEFAULTS = [];
let POKJA_DEFAULTS = [];
let KATEGORI_DEFAULTS = [];
let lastDataSignature = '';
let isCloudDataLoaded = false;

let lastFilteredPMList = [];
let lastFilteredPegawaiList = [];
let lastFilteredPerkembanganList = [];
let pollingPausedUntil = 0;

/* --- UTILITAS DATA & TAMPILAN --- */
function str(value) {
    return (value === null || value === undefined) ? '' : String(value);
}

function esc(value) {
    return str(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function pad2(num) {
    return String(num).padStart(2, '0');
}

function safeInitial(name) {
    const match = str(name).trim().match(/[A-Za-z0-9\u00C0-\u024F]/);
    return (match ? match[0] : '?').toUpperCase();
}

function isUsablePhoto(src) {
    const value = str(src).trim();
    return /^data:image\//i.test(value) || /^https?:\/\//i.test(value) || /^img\//i.test(value);
}

/* Foto selalu punya avatar inisial di belakang; jika gambar gagal dimuat, inisial tetap terlihat. */
function photoThumbHtml(foto, nama, sizeClasses, extraClasses = '') {
    const image = isUsablePhoto(foto)
        ? `<img src="${esc(foto)}" alt="Foto ${esc(nama)}" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">`
        : '';
    return `<div class="relative ${sizeClasses} ${extraClasses} overflow-hidden bg-indigo-100 border border-indigo-200 flex items-center justify-center shrink-0">
        <span class="text-indigo-700 font-extrabold">${esc(safeInitial(nama))}</span>
        ${image}
    </div>`;
}

function uniqueValues(...lists) {
    const seen = new Set();
    const result = [];
    lists.forEach(list => {
        (list || []).forEach(item => {
            const value = str(item).trim();
            if (value && !seen.has(value)) {
                seen.add(value);
                result.push(value);
            }
        });
    });
    return result;
}

function setSelectOptions(select, values, placeholderText) {
    if (!select) return;
    const previous = select.value;
    const options = [];
    if (placeholderText !== undefined && placeholderText !== null) {
        options.push(`<option value="">${esc(placeholderText)}</option>`);
    }
    (values || []).forEach(value => options.push(`<option value="${esc(value)}">${esc(value)}</option>`));
    select.innerHTML = options.join('');
    if (previous && Array.from(select.options).some(opt => opt.value === previous)) {
        select.value = previous;
    }
}

function normalizeAsramaValue(value) {
    const raw = str(value).trim();
    if (!raw) return '';
    const norm = text => str(text).toLowerCase().replace(/^asrama\s+/, '').replace(/\s+/g, ' ').trim();
    const match = ASRAMA_DEFAULTS.find(option => norm(option) === norm(raw));
    return match || raw;
}

function isSameAsrama(a, b) {
    const left = normalizeAsramaValue(a);
    const right = normalizeAsramaValue(b);
    if (!left || !right) return false;
    return left.toLowerCase() === right.toLowerCase();
}

function normalizeKasusPM(kasus) {
    const text = str(kasus).trim();
    if (!text) return '';
    return text.toLowerCase() === 'anak berhadapan dengan hukum' ? 'ABH' : text;
}

function normalizePMRecord(pm) {
    const asrama = normalizeAsramaValue(pm.asrama || pm.residensial || '');
    return Object.assign({}, pm, {
        id: str(pm.id).trim(),
        nama: str(pm.nama).trim(),
        ibu: str(pm.ibu).trim(),
        jk: str(pm.jk).trim(),
        kasus: normalizeKasusPM(pm.kasus),
        vokasional: str(pm.vokasional).trim(),
        asrama: asrama,
        residensial: asrama,
        status: str(pm.status).trim(),
        peksos: str(pm.peksos).trim(),
        masuk: str(pm.masuk).trim(),
        terminasi: str(pm.terminasi).trim(),
        foto: str(pm.foto).trim(),
        createdByAccount: str(pm.createdByAccount).trim()
    });
}

function normalizePegawaiRecord(peg) {
    return Object.assign({}, peg, {
        id: str(peg.id).trim(),
        nama: str(peg.nama).trim(),
        nip: str(peg.nip).trim(),
        jabatan: str(peg.jabatan).trim(),
        pokja: str(peg.pokja).trim(),
        vokasional: str(peg.vokasional).trim(),
        asrama: normalizeAsramaValue(peg.asrama || ''),
        pengasuhAsrama: peg.pengasuhAsrama === true || String(peg.pengasuhAsrama).toLowerCase() === 'true',
        foto: str(peg.foto).trim(),
        createdByAccount: str(peg.createdByAccount).trim()
    });
}

function normalizePerkembanganRecord(rec) {
    return Object.assign({}, rec, {
        id: str(rec.id).trim(),
        pmId: str(rec.pmId).trim(),
        tanggal: str(rec.tanggal).trim(),
        kategori: str(rec.kategori).trim(),
        deskripsi: str(rec.deskripsi).trim(),
        rekomendasi: str(rec.rekomendasi).trim(),
        petugas: str(rec.petugas).trim(),
        foto: str(rec.foto).trim(),
        createdByAccount: str(rec.createdByAccount).trim()
    });
}

function dedupeById(list) {
    const seen = new Set();
    return (list || []).filter(item => {
        const id = str(item.id);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function isPegawaiLinkedToAccount(peg, account) {
    if (!peg || !account) return false;
    const username = str(account.username).trim();
    const usernameKey = username.toLowerCase();
    return Boolean(
        (account.pegawaiId && str(peg.id) === str(account.pegawaiId)) ||
        (peg.createdByAccount && peg.createdByAccount === username) ||
        (account.nip && str(peg.nip) === str(account.nip)) ||
        (account.nama && str(peg.nama).toLowerCase() === str(account.nama).toLowerCase()) ||
        (usernameKey && str(peg.nip).trim() === username) ||
        (usernameKey && str(peg.id).trim().toLowerCase() === usernameKey)
    );
}

function getMyPegawai() {
    if (!currentUser) return null;
    const account = usersDB[currentUser.username] || currentUser;
    return dataPegawai.find(peg => isPegawaiLinkedToAccount(peg, account)) || null;
}

function findLinkedAccount(peg) {
    if (!peg) return '';
    const direct = Object.values(usersDB).find(user =>
        user.role !== 'admin' && user.pegawaiId && str(user.pegawaiId) === str(peg.id));
    if (direct) return direct.username;
    const creator = str(peg.createdByAccount);
    if (creator && usersDB[creator] && usersDB[creator].role !== 'admin') return creator;
    const nipMatch = str(peg.nip).trim();
    if (nipMatch) {
        const byNip = Object.values(usersDB).find(user =>
            user.role !== 'admin' && str(user.username).trim() === nipMatch);
        if (byNip) return byNip.username;
    }
    return '';
}

function linkAccountToPegawai(pegawaiId, username) {
    if (!currentUser || currentUser.role !== 'admin') return;
    const peg = dataPegawai.find(item => str(item.id) === str(pegawaiId));
    if (!peg) return;

    Object.keys(usersDB).forEach(name => {
        if (str(usersDB[name].pegawaiId) === str(peg.id)) usersDB[name].pegawaiId = null;
    });

    if (username && usersDB[username]) {
        usersDB[username].pegawaiId = peg.id;
        addSystemLog('Hubungkan Akun', `Akun ${username} dihubungkan ke profil pegawai ${peg.nama}.`);
        showToast(`Akun "${username}" kini terhubung ke ${peg.nama}.`);
    } else {
        addSystemLog('Lepas Akun', `Tautan akun pada profil pegawai ${peg.nama} dilepas.`);
        showToast(`Tautan akun pada profil ${peg.nama} dilepas.`);
    }

    saveData();
    renderPegawaiTable();
    renderAllUsersTable();
    refreshAsramaEntryVisibility();
}

function computeDataSignature() {
    try {
        return JSON.stringify([dataPM, dataPegawai, dataPerkembangan, pwdRequests]);
    } catch (error) {
        return String(Date.now());
    }
}

function parseDateSafe(value) {
    const text = str(value).trim();
    if (!text) return null;

    // Tanggal murni (YYYY-MM-DD) dibaca sebagai waktu lokal agar tidak bergeser satu hari.
    const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function toDateInputValue(value) {
    const date = parseDateSafe(value);
    if (!date) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toDateTimeLocalValue(value) {
    const date = parseDateSafe(value);
    if (!date) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function generateRecordId(prefix) {
    return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

/* --- DIALOG KUSTOM (ALERT & KONFIRMASI) --- */
const nativeAlertDialog = window.alert.bind(window);
let appConfirmResolver = null;

function showAppAlert(message, options = {}) {
    const modal = document.getElementById('modal-alert');
    if (!modal) {
        nativeAlertDialog(str(message));
        return;
    }
    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-message');
    const iconEl = document.getElementById('alert-icon');
    if (titleEl) titleEl.innerText = options.title || 'Informasi';
    if (msgEl) msgEl.innerText = str(message);
    if (iconEl) iconEl.className = `dialog-icon ${options.icon || 'dialog-icon-info'}`;
    modal.classList.remove('hidden');
    const okBtn = modal.querySelector('.modal-foot button');
    if (okBtn) setTimeout(() => okBtn.focus(), 30);
}

function closeAppAlert() {
    const modal = document.getElementById('modal-alert');
    if (modal) modal.classList.add('hidden');
}

function showAppConfirm(message, options = {}) {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-confirm');
        if (!modal) {
            resolve(window.confirm(str(message)));
            return;
        }
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        if (titleEl) titleEl.innerText = options.title || 'Konfirmasi';
        if (msgEl) msgEl.innerText = str(message);
        if (okBtn) {
            okBtn.innerText = options.okLabel || 'Ya, Lanjutkan';
            okBtn.className = `btn ${options.danger === false ? 'btn-primary' : 'btn-danger'}`;
        }
        appConfirmResolver = resolve;
        modal.classList.remove('hidden');
        if (okBtn) setTimeout(() => okBtn.focus(), 30);
    });
}

function resolveAppConfirm(result) {
    const modal = document.getElementById('modal-confirm');
    if (modal) modal.classList.add('hidden');
    const resolver = appConfirmResolver;
    appConfirmResolver = null;
    if (resolver) resolver(Boolean(result));
}

// Semua alert lama otomatis memakai dialog yang seragam dengan tampilan aplikasi.
window.alert = function (message) {
    showAppAlert(message);
};

document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    const alertModal = document.getElementById('modal-alert');
    if (alertModal && !alertModal.classList.contains('hidden')) {
        closeAppAlert();
        return;
    }
    const confirmModal = document.getElementById('modal-confirm');
    if (confirmModal && !confirmModal.classList.contains('hidden')) {
        resolveAppConfirm(false);
        return;
    }
    const notifDropdown = document.getElementById('notif-dropdown');
    if (notifDropdown) notifDropdown.classList.add('hidden');
});

document.addEventListener('click', function (event) {
    const notifWidget = document.getElementById('system-notif-widget');
    const notifDropdown = document.getElementById('notif-dropdown');
    if (!notifDropdown || notifDropdown.classList.contains('hidden')) return;
    if (notifWidget && !notifWidget.contains(event.target)) {
        notifDropdown.classList.add('hidden');
    }
});

const alertModalEl = document.getElementById('modal-alert');
if (alertModalEl) {
    alertModalEl.addEventListener('click', event => {
        if (event.target === alertModalEl) closeAppAlert();
    });
}

const confirmModalEl = document.getElementById('modal-confirm');
if (confirmModalEl) {
    confirmModalEl.addEventListener('click', event => {
        if (event.target === confirmModalEl) resolveAppConfirm(false);
    });
}

window.addEventListener('resize', () => {
    const notifDropdown = document.getElementById('notif-dropdown');
    if (notifDropdown) notifDropdown.classList.add('hidden');
});

window.onload = function() {
    captureDefaultOptions();
    initUsersDB();
    loadSession();
    bindPhotoPreview('pm-foto', 'pm-foto-preview');
    bindPhotoPreview('pegawai-foto', 'pegawai-foto-preview');
    bindPhotoPreview('perkembangan-foto', 'perkembangan-foto-preview');
    bindPhotoPreview('init-pegawai-foto', 'init-pegawai-foto-preview');
    loadDataFromCloud();
    initDarkModeState();

    setInterval(() => {
        loadDataFromCloud();
    }, 5000);
};

function captureDefaultOptions() {
    const grab = id => {
        const el = document.getElementById(id);
        return el ? Array.from(el.options).map(opt => opt.value).filter(value => value !== '') : [];
    };
    KASUS_DEFAULTS = grab('pm-kasus');
    VOKASIONAL_DEFAULTS = grab('pm-vokasional');
    ASRAMA_DEFAULTS = grab('pm-nama-asrama-select');
    JABATAN_DEFAULTS = grab('pegawai-jabatan');
    POKJA_DEFAULTS = grab('pegawai-pokja');
    KATEGORI_DEFAULTS = grab('filter-kategori-perkembangan');
}

/* --- FITUR MODE GELAP --- */
function initDarkModeState() {
    const isDark = localStorage.getItem('sh_dark_mode') === 'true';
    if (isDark) {
        document.body.classList.add('dark-mode');
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('sh_dark_mode', isDark);
    renderCharts();
    showToast(isDark ? 'Mode Gelap diaktifkan' : 'Mode Terang diaktifkan');
}

/* --- WIDGET NOTIFIKASI AKTIVITAS (KHUSUS ADMIN) --- */
function addSystemLog(action, description) {
    const logItem = {
        id: 'LOG_' + Date.now(),
        time: new Date().toISOString(),
        user: currentUser ? currentUser.username : 'system',
        action: action,
        desc: description
    };
    systemLogs.unshift(logItem);
    if (systemLogs.length > 50) systemLogs.pop();
    updateNotificationWidget();
}

function updateNotificationWidget() {
    const badge = document.getElementById('notif-badge');
    const listContainer = document.getElementById('notif-list-container');
    const countText = document.getElementById('notif-count-text');
    if (!badge || !listContainer) return;

    badge.innerText = systemLogs.length;
    if (systemLogs.length > 0) {
        badge.classList.remove('hidden');
        if(countText) countText.innerText = `${systemLogs.length} aktivitas baru`;
    } else {
        badge.classList.add('hidden');
        if(countText) countText.innerText = `Tidak ada aktivitas`;
    }

    if (systemLogs.length === 0) {
        listContainer.innerHTML = `<div class="p-4 text-center text-slate-400 text-xs italic">Belum ada riwayat perubahan data.</div>`;
    } else {
        listContainer.innerHTML = systemLogs.map(log => `
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100 transition">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-bold text-indigo-700 text-[11px]"><i class="fa-solid fa-circle-user mr-1"></i>${esc(log.user)}</span>
                    <span class="text-[10px] text-slate-400 font-mono">${formatDateWithTime(log.time)}</span>
                </div>
                <p class="text-xs text-slate-700 font-medium"><strong>${esc(log.action)}:</strong> ${esc(log.desc)}</p>
            </div>
        `).join('');
    }
}

function toggleNotificationDropdown() {
    const dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;

    const willOpen = dropdown.classList.contains('hidden');
    if (willOpen) {
        const widget = document.getElementById('system-notif-widget');
        const rect = widget.getBoundingClientRect();
        const width = Math.min(340, window.innerWidth - 32);
        const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.left));

        dropdown.style.position = 'fixed';
        dropdown.style.top = `${Math.round(rect.bottom + 8)}px`;
        dropdown.style.left = `${Math.round(left)}px`;
        dropdown.style.right = 'auto';
        dropdown.style.width = `${Math.round(width)}px`;
        dropdown.style.marginTop = '0';
    }

    dropdown.classList.toggle('hidden');
}

/* --- FITUR EKSPOR GRAFIK KE PNG --- */
function downloadChartAsPNG(canvasId, filename) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const imageURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = imageURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Grafik berhasil diunduh ke format PNG!');
}

function renderCharts() {
    const kasusCounts = {};
    dataPM.forEach(pm => {
        const kasus = pm.kasus || 'Lainnya';
        kasusCounts[kasus] = (kasusCounts[kasus] || 0) + 1;
    });

    const ctxKasus = document.getElementById('chartKasus');
    if (ctxKasus) {
        if (chartKasusInstance) chartKasusInstance.destroy();
        chartKasusInstance = new Chart(ctxKasus, {
            type: 'doughnut',
            data: {
                labels: Object.keys(kasusCounts),
                datasets: [{
                    data: Object.values(kasusCounts),
                    backgroundColor: [
                        '#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', 
                        '#8b5cf6', '#ec4899', '#64748b', '#3b82f6', '#14b8a6'
                    ],
                    borderWidth: 2,
                    borderColor: document.body.classList.contains('dark-mode') ? '#1e293b' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { 
                            boxWidth: 8, 
                            font: { size: 9 },
                            color: document.body.classList.contains('dark-mode') ? '#cbd5e1' : '#1e293b'
                        }
                    }
                }
            }
        });
    }

    const vokasionalCounts = {};
    dataPM.forEach(pm => {
        const vok = pm.vokasional || 'Tidak Ada';
        vokasionalCounts[vok] = (vokasionalCounts[vok] || 0) + 1;
    });

    const ctxVok = document.getElementById('chartVokasional');
    if (ctxVok) {
        if (chartVokasionalInstance) chartVokasionalInstance.destroy();
        chartVokasionalInstance = new Chart(ctxVok, {
            type: 'bar',
            data: {
                labels: Object.keys(vokasionalCounts),
                datasets: [{
                    label: 'Jumlah PM',
                    data: Object.values(vokasionalCounts),
                    backgroundColor: '#4f46e5',
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { font: { size: 9 }, color: document.body.classList.contains('dark-mode') ? '#cbd5e1' : '#1e293b' } },
                    y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 }, color: document.body.classList.contains('dark-mode') ? '#cbd5e1' : '#1e293b' } }
                }
            }
        });
    }
}

function initUsersDB() {
    usersDB = {
        'admin': { username: 'admin', password: 'admin123', role: 'admin', pegawaiId: 'PEG_ADMIN1' },
        'admin2': { username: 'admin2', password: 'admin123', role: 'admin', pegawaiId: 'PEG_ADMIN2' },
        'admin3': { username: 'admin3', password: 'admin123', role: 'admin', pegawaiId: 'PEG_ADMIN3' },
        'admin4': { username: 'admin4', password: 'admin123', role: 'admin', pegawaiId: 'PEG_ADMIN4' },
        'admin5': { username: 'admin5', password: 'admin123', role: 'admin', pegawaiId: 'PEG_ADMIN5' }
    };
    for (let i = 1; i <= 200; i++) {
        const username = `user${i}`;
        usersDB[username] = {
            username: username,
            password: 'pass123',
            role: 'user',
            pegawaiId: null
        };
    }
}

function openResetPasswordModal() {
    document.getElementById('modal-reset-pwd').classList.remove('hidden');
}

function closeResetPasswordModal() {
    document.getElementById('modal-reset-pwd').classList.add('hidden');
}

function submitAccountChangeRequest(e) {
    e.preventDefault();
    const oldUsername = document.getElementById('req-old-username').value.trim();
    const newUsernameInput = document.getElementById('req-new-username');
    const newPasswordInput = document.getElementById('req-new-password');

    if (!usersDB[oldUsername]) {
        alert('Username lama tidak ditemukan dalam sistem!');
        return;
    }

    const req = {
        id: 'REQ_' + Date.now(),
        username: oldUsername,
        newUsername: newUsernameInput ? newUsernameInput.value.trim() : oldUsername,
        newPassword: newPasswordInput ? newPasswordInput.value.trim() : '-',
        status: 'pending',
        time: new Date().toISOString()
    };

    pwdRequests.push(req);
    saveData();
    closeResetPasswordModal();
    addSystemLog('Permintaan Akun', `User ${oldUsername} mengajukan perubahan kredensial.`);
    alert('Permintaan perubahan akun berhasil dikirim ke Master Admin.');
}

function renderPwdRequestsTable() {
    if (!currentUser || currentUser.role !== 'admin') return;

    const tbody = document.getElementById('pwd-requests-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const pendingReqs = pwdRequests.filter(r => r.status === 'pending');
    const badgeEl = document.getElementById('pwd-req-badge');
    if (badgeEl) {
        badgeEl.innerText = pendingReqs.length;
        if (pendingReqs.length > 0) {
            badgeEl.classList.remove('hidden');
        } else {
            badgeEl.classList.add('hidden');
        }
    }

    if (pwdRequests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">Belum ada permintaan perubahan akun.</td></tr>`;
    } else {
        pwdRequests.forEach(req => {
            const displayUsername = req.newUsername || req.value || '-';
            const displayPassword = req.newPassword || req.newPwd || '-';

            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition border-b border-slate-100";
            tr.innerHTML = `
                <td class="p-3 font-mono text-xs text-slate-600">${formatDateWithTime(req.time)}</td>
                <td class="p-3 font-bold text-slate-800">${req.username}</td>
                <td class="p-3 font-mono text-indigo-600 font-bold">${displayUsername}</td>
                <td class="p-3 font-mono text-emerald-600 font-bold">${displayPassword}</td>
                <td class="p-3">
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold ${req.status === 'pending' ? 'bg-amber-100 text-amber-700' : (req.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}">
                        ${req.status.toUpperCase()}
                    </span>
                </td>
                <td class="p-3 text-center">
                    ${req.status === 'pending' ? `
                        <div class="flex items-center justify-center space-x-2">
                            <button onclick="approveAccountRequest('${req.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow transition"><i class="fa-solid fa-check mr-1"></i> Setujui</button>
                            <button onclick="rejectAccountRequest('${req.id}')" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow transition"><i class="fa-solid fa-xmark mr-1"></i> Tolak</button>
                        </div>
                    ` : '<span class="text-xs text-slate-400 font-medium">-</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderAllUsersTable();
}

function getAccountPegawaiLink(username) {
    const acc = usersDB[username];
    if (!acc) return null;
    return dataPegawai.find(p => isPegawaiLinkedToAccount(p, acc)) || null;
}

function checkAccountActionAllowed(username, actionLabel) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert(`Akses ditolak! Hanya Master Admin yang dapat ${actionLabel} akun.`);
        return false;
    }
    if (username === 'admin' || username === currentUser.username) {
        alert(`Anda tidak dapat ${actionLabel} akun master admin yang sedang aktif.`);
        return false;
    }
    const acc = usersDB[username];
    if (!acc) {
        alert(`Akun "${username}" tidak ditemukan dalam database.`);
        return false;
    }
    if (acc.role === 'admin') {
        alert(`Akun "${username}" adalah akun admin dan tidak dapat ${actionLabel}.`);
        return false;
    }
    return true;
}

async function resetUserAccount(username) {
    if (!checkAccountActionAllowed(username, 'mereset')) return;

    const linkedPegawai = getAccountPegawaiLink(username);
    const resetTarget = linkedPegawai
        ? `Profil pegawai "${linkedPegawai.nama}" yang terikat akan dihapus dan akun`
        : 'Akun';
    const confirmed = await showAppConfirm(
        `Reset akun "${username}"? ${resetTarget} akan kembali menjadi akun baru dengan password default "pass123".`,
        { title: 'Reset Akun Pengguna', okLabel: 'Ya, Reset Akun', danger: false }
    );
    if (!confirmed) return;

    if (linkedPegawai) {
        dataPegawai = dataPegawai.filter(p => p.id !== linkedPegawai.id);
    }

    usersDB[username] = {
        username: username,
        password: 'pass123',
        role: 'user',
        pegawaiId: null
    };

    saveData();
    renderPegawaiTable();
    renderPMTable();
    renderPerkembanganTable();
    renderAllUsersTable();
    addSystemLog('Reset Akun', `Akun ${username} direset oleh Master Admin.`);
    showToast(`Akun "${username}" berhasil direset dan kembali bersih!`);
}

async function deleteUserAccount(username) {
    if (!checkAccountActionAllowed(username, 'menghapus')) return;

    const linkedPegawai = getAccountPegawaiLink(username);
    const confirmed = await showAppConfirm(
        `Hapus akun "${username}" secara permanen? Akun ini tidak akan bisa digunakan lagi untuk masuk.${linkedPegawai ? ` Profil pegawai "${linkedPegawai.nama}" yang terikat juga akan dihapus.` : ''}`,
        { title: 'Hapus Akun Pengguna', okLabel: 'Ya, Hapus Akun' }
    );
    if (!confirmed) return;

    if (linkedPegawai) {
        dataPegawai = dataPegawai.filter(p => p.id !== linkedPegawai.id);
    }

    delete usersDB[username];

    saveData();
    renderPegawaiTable();
    renderPMTable();
    renderPerkembanganTable();
    renderAllUsersTable();
    addSystemLog('Hapus Akun', `Akun ${username} dihapus permanen oleh Master Admin.`);
    showToast(`Akun "${username}" berhasil dihapus.`);
}

function renderAllUsersTable() {
    if (!currentUser || currentUser.username !== 'admin') return;

    const tbody = document.getElementById('all-users-table-body');
    const countEl = document.getElementById('total-users-count');
    const searchInput = document.getElementById('search-all-users');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (!tbody) return;
    tbody.innerHTML = '';

    const usernames = Object.keys(usersDB);
    const filteredUsernames = usernames.filter(username => {
        const acc = usersDB[username];
        const linkedPegawai = acc.role === 'admin' ? null : getAccountPegawaiLink(username);
        const isRegistered = acc.role === 'admin' || acc.pegawaiId !== null || !!linkedPegawai;
        const statusStr = isRegistered ? 'aktif terpakai' : 'belum pernah dipakai baru';
        const pegawaiName = linkedPegawai ? linkedPegawai.nama.toLowerCase() : '';

        return username.toLowerCase().includes(search) || 
               acc.role.toLowerCase().includes(search) || 
               statusStr.includes(search) || 
               pegawaiName.includes(search);
    });

    if (countEl) countEl.innerText = filteredUsernames.length;

    if (filteredUsernames.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">Tidak ada akun user yang cocok dengan pencarian.</td></tr>`;
        return;
    }

    filteredUsernames.forEach(username => {
        const acc = usersDB[username];
        const linkedPegawai = acc.role === 'admin' ? null : getAccountPegawaiLink(username);
        const isRegistered = acc.role === 'admin' || acc.pegawaiId !== null || !!linkedPegawai;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition border-b border-slate-100";
        tr.innerHTML = `
            <td class="p-3 font-bold font-mono text-slate-900">${acc.username}</td>
            <td class="p-3">
                <span class="px-2.5 py-1 rounded-full text-xs font-extrabold ${acc.role === 'admin' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}">
                    ${acc.role.toUpperCase()}
                </span>
            </td>
            <td class="p-3">
                ${isRegistered 
                    ? '<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold">Aktif / Terpakai</span>' 
                    : '<span class="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold">Belum Pernah Dipakai (Baru)</span>'}
            </td>
            <td class="p-3 text-slate-700 font-medium">
                ${acc.role === 'admin'
                    ? '<span class="text-slate-400 italic">Akun Administrator</span>'
                    : (linkedPegawai
                        ? `${linkedPegawai.nama} <span class="text-xs text-slate-400 font-normal">(${linkedPegawai.jabatan})</span>`
                        : '<span class="text-slate-400 italic">Belum ada profil</span> <span class="block text-[10px] text-indigo-500 font-semibold">Hubungkan lewat tab Pegawai → kolom Akun Linked</span>')}
            </td>
            <td class="p-3 text-center">
                ${acc.role !== 'admin' ? `
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="resetUserAccount('${acc.username}')" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow transition text-xs" title="Kembalikan akun ke kondisi baru">
                            <i class="fa-solid fa-rotate-left mr-1"></i> Reset
                        </button>
                        <button onclick="deleteUserAccount('${acc.username}')" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow transition text-xs" title="Hapus akun secara permanen">
                            <i class="fa-solid fa-trash-can mr-1"></i> Hapus
                        </button>
                    </div>
                ` : '<span class="text-slate-400 italic text-xs font-medium">Akun Master Utama</span>'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function approveAccountRequest(reqId) {
    if (!currentUser || currentUser.username !== 'admin') {
        alert('Akses ditolak!');
        return;
    }

    const req = pwdRequests.find(r => r.id === reqId);
    if (req) {
        req.status = 'approved';
        const targetUsername = req.username;
        const newUsername = (req.newUsername && req.newUsername !== '-') ? req.newUsername : targetUsername;
        const newPassword = (req.newPassword && req.newPassword !== '-') ? req.newPassword : null;

        if (usersDB[targetUsername]) {
            if (newPassword) {
                usersDB[targetUsername].password = newPassword;
            }

            if (targetUsername !== newUsername) {
                usersDB[newUsername] = {
                    username: newUsername,
                    password: usersDB[targetUsername].password,
                    role: usersDB[targetUsername].role,
                    pegawaiId: usersDB[targetUsername].pegawaiId
                };
                delete usersDB[targetUsername];

                dataPM.forEach(pm => { if (pm.createdByAccount === targetUsername) pm.createdByAccount = newUsername; });
                dataPegawai.forEach(peg => { if (peg.createdByAccount === targetUsername) peg.createdByAccount = newUsername; });
                dataPerkembangan.forEach(perk => { if (perk.createdByAccount === targetUsername) perk.createdByAccount = newUsername; });
            }
        }

        saveData();
        renderPwdRequestsTable();
        renderPMTable();
        renderPegawaiTable();
        renderPerkembanganTable();
        addSystemLog('Setujui Akun', `Permintaan perubahan akun ${targetUsername} disetujui.`);
        showToast('Permintaan akun berhasil disetujui & diperbarui!');
    }
}

function rejectAccountRequest(reqId) {
    if (!currentUser || currentUser.username !== 'admin') return;
    const req = pwdRequests.find(r => r.id === reqId);
    if (req) {
        req.status = 'rejected';
        saveData();
        renderPwdRequestsTable();
        showToast('Permintaan perubahan akun ditolak.');
    }
}

function updateAdminUI() {
    const btnTambahPegawai = document.getElementById('btn-tambah-pegawai');
    const tabAdminBtn = document.getElementById('tab-admin-btn');
    const adminClickInfo = document.getElementById('admin-click-info');
    const activeWidgetUser = document.getElementById('admin-widget-username');
    const notifWidget = document.getElementById('system-notif-widget'); // Widget Notifikasi Pojok Kanan Bawah

    if (currentUser && currentUser.role === 'admin') {
        if (btnTambahPegawai) {
            btnTambahPegawai.classList.remove('hidden');
            btnTambahPegawai.classList.add('flex');
        }
        if (adminClickInfo) adminClickInfo.classList.remove('hidden');
        if (activeWidgetUser) activeWidgetUser.innerText = `${currentUser.username} (${currentUser.role === 'admin' ? 'Master Admin' : 'Admin'})`;

        // Tampilkan widget notifikasi pojok kanan bawah khusus untuk admin
        if (notifWidget) {
            notifWidget.classList.remove('hidden');
        }

        if (tabAdminBtn) {
            if (currentUser.username === 'admin') {
                tabAdminBtn.classList.remove('hidden');
            } else {
                tabAdminBtn.classList.add('hidden');
            }
        }
    } else {
        if (btnTambahPegawai) {
            btnTambahPegawai.classList.add('hidden');
            btnTambahPegawai.classList.remove('flex');
        }
        if (adminClickInfo) adminClickInfo.classList.add('hidden');
        if (tabAdminBtn) tabAdminBtn.classList.add('hidden');
        
        // Sembunyikan widget notifikasi jika yang login bukan admin
        if (notifWidget) {
            notifWidget.classList.add('hidden');
        }
    }

    updateUserChrome();
    refreshAsramaEntryVisibility();
}

function updateUserChrome() {
    const initialEl = document.getElementById('header-user-initial');
    const nameEl = document.getElementById('logged-username-label');
    const roleEl = document.getElementById('logged-user-role');

    if (!currentUser) {
        if (initialEl) initialEl.innerText = '?';
        if (nameEl) nameEl.innerText = 'Akun Saya';
        if (roleEl) roleEl.innerText = 'Petugas';
        return;
    }

    if (nameEl) nameEl.innerText = currentUser.username || 'Akun Saya';
    if (initialEl) initialEl.innerText = safeInitial(currentUser.username || '?');

    if (roleEl) {
        if (currentUser.role === 'admin') {
            roleEl.innerText = currentUser.username === 'admin' ? 'Master Admin' : 'Admin';
        } else {
            const pegawai = getMyPegawai();
            roleEl.innerText = (pegawai && pegawai.jabatan) ? pegawai.jabatan : 'Petugas';
        }
    }
}

function updateDashboardKPIs() {
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    };
    const residensial = dataPM.filter(pm => str(pm.asrama).trim()).length;
    const catatanCount = (currentUser && currentUser.role !== 'admin')
        ? dataPerkembangan.filter(rec => str(rec.createdByAccount) === currentUser.username).length
        : dataPerkembangan.length;

    setText('kpi-total-pm', dataPM.length);
    setText('kpi-residensial', residensial);
    setText('kpi-total-pegawai', dataPegawai.length);
    setText('kpi-total-catatan', catatanCount);
}

function updateJurnalSubTitle() {
    const subTitleEl = document.getElementById('sub-title-jurnal');
    if (!subTitleEl) return;

    if (!currentUser || currentUser.role === 'admin') {
        subTitleEl.innerText = "Rekam perkembangan harian, sosial, medis, psikologis, dan vokasional PM (Akses Admin)";
        return;
    }

    const myPegawai = getMyPegawai();
    if (!myPegawai) {
        subTitleEl.innerText = "Rekam perkembangan harian, sosial, medis, dan psikologis PM";
        return;
    }

    if (myPegawai.jabatan === 'Instruktur') {
        subTitleEl.innerText = `Rekam perkembangan khusus bidang ${myPegawai.vokasional || 'Vokasional'} Penerima Manfaat`;
    } else if (myPegawai.jabatan === 'Pengasuh') {
        subTitleEl.innerText = `Rekam perkembangan kedisiplinan dan pengasuhan asrama ${myPegawai.asrama || 'Residensial'}`;
    } else if (myPegawai.jabatan === 'Petugas Keamanan') {
        subTitleEl.innerText = "Rekam laporan pengamanan, kedisiplinan, dan perilaku Penerima Manfaat";
    } else if (myPegawai.jabatan === 'Pekerja Sosial') {
        subTitleEl.innerText = "Rekam asesmen psikososial, kasus, dan pemantauan intervensi Penerima Manfaat";
    } else {
        subTitleEl.innerText = `Rekam perkembangan Penerima Manfaat berdasarkan bidang tugas ${myPegawai.jabatan}`;
    }
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_EXPIRY_KEY = 'sh_session_expiry';
let lastSessionRefresh = 0;

function refreshSessionExpiry() {
    if (!currentUser) return;
    const now = Date.now();
    if (now - lastSessionRefresh < 60000 && localStorage.getItem(SESSION_EXPIRY_KEY)) return;
    lastSessionRefresh = now;
    localStorage.setItem(SESSION_EXPIRY_KEY, String(now + SESSION_TIMEOUT_MS));
}

function isSessionExpired() {
    const expiry = Number(localStorage.getItem(SESSION_EXPIRY_KEY)) || 0;
    return expiry > 0 && Date.now() > expiry;
}

function clearSessionStorage() {
    localStorage.removeItem('sh_logged_user');
    localStorage.removeItem(SESSION_EXPIRY_KEY);
}

['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, refreshSessionExpiry, { passive: true });
});

setInterval(() => {
    if (currentUser && isSessionExpired()) {
        const wasAdmin = currentUser.role === 'admin';
        handleLogout();
        goToLogin();
        alert(`Sesi ${wasAdmin ? 'admin ' : ''}Anda telah berakhir setelah 30 menit tidak aktif. Silakan login kembali.`);
    }
}, 15000);

function loadSession() {
    const saved = localStorage.getItem('sh_logged_user');

    if (saved) {
        try {
            currentUser = JSON.parse(saved);
        } catch (error) {
            currentUser = null;
        }

        if (!currentUser || !currentUser.username) {
            currentUser = null;
            clearSessionStorage();
            document.getElementById('welcome-screen').classList.remove('hidden');
            updateAdminUI();
            return;
        }

        if (isSessionExpired()) {
            const expiredUser = currentUser.username;
            currentUser = null;
            clearSessionStorage();
            handleLogout();
            goToLogin();
            alert(`Sesi "${expiredUser}" telah berakhir (batas 30 menit). Silakan login kembali.`);
            return;
        }

        if (usersDB[currentUser.username]) {
            currentUser = usersDB[currentUser.username];
        }
        document.getElementById('welcome-screen').classList.add('hidden');
        document.getElementById('login-screen').classList.add('hidden');

        const userLabel = document.getElementById('logged-username-label');
        if (userLabel) userLabel.innerText = currentUser.username;

        updateAdminUI();
        updateJurnalSubTitle();
        refreshSessionExpiry();
        switchTab('pm');
    } else {
        document.getElementById('welcome-screen').classList.remove('hidden');
        updateAdminUI();
    }
}

function goToLogin() {
    document.getElementById('welcome-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-box').classList.remove('hidden');
    document.getElementById('pegawai-init-box').classList.add('hidden');
}

function clearLoginForm() {
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    showToast('Form login berhasil dibersihkan.');
}

async function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value.trim();

    // Pastikan data akun & pegawai dari cloud sudah termuat agar keterikatan profil tidak salah baca.
    if (!isCloudDataLoaded) {
        try { await loadDataFromCloud(); } catch (error) { console.error(error); }
    }

    if (usersDB[u] && usersDB[u].password === p) {
        currentUser = usersDB[u];
        localStorage.setItem('sh_logged_user', JSON.stringify(currentUser));
        refreshSessionExpiry();

        // Admin tidak perlu mengisi profil pegawai (langsung masuk dashboard)
        if (currentUser.role === 'admin') {
            document.getElementById('login-screen').classList.add('hidden');
            const userLabel = document.getElementById('logged-username-label');
            if (userLabel) userLabel.innerText = currentUser.username;

            updateAdminUI();
            updateJurnalSubTitle();

            showToast(`Selamat datang, Master Admin ${currentUser.username}!`);
            renderPMTable();
            renderPegawaiTable();
            renderPerkembanganTable();
            switchTab('pm');
            return;
        }

        // Cek keterikatan profil pegawai: via pegawaiId akun, kepemilikan data, atau NIP petugas.
        const myPegawai = getMyPegawai() || dataPegawai.find(p => str(p.nip) === '199205262025061002') || null;

        if (!myPegawai) {
            document.getElementById('login-box').classList.add('hidden');
            document.getElementById('pegawai-init-box').classList.remove('hidden');
            toggleInitConditionalFields();
        } else {
            if (str(currentUser.pegawaiId) !== str(myPegawai.id)) {
                currentUser.pegawaiId = myPegawai.id;
                usersDB[currentUser.username].pegawaiId = myPegawai.id;
                localStorage.setItem('sh_logged_user', JSON.stringify(currentUser));
            }
            document.getElementById('login-screen').classList.add('hidden');
            const userLabel = document.getElementById('logged-username-label');
            if (userLabel) userLabel.innerText = currentUser.username;

            updateAdminUI();
            updateJurnalSubTitle();

            showToast(`Selamat datang, ${currentUser.username}!`);
            renderPMTable();
            renderPegawaiTable();
            renderPerkembanganTable();
            switchTab('pm');
        }
    } else {
        alert('Username atau Password salah!');
    }
}

function handleLogout() {
    currentUser = null;
    clearSessionStorage();

    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';

    document.getElementById('welcome-screen').classList.remove('hidden');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('tab-admin-btn').classList.add('hidden');
    updateAdminUI();
    switchTab('pm');
}

function toggleInitConditionalFields() {
    const jabatan = document.getElementById('init-pegawai-jabatan').value;
    const wrapperVokasional = document.getElementById('init-wrapper-vokasional');
    if (jabatan === 'Instruktur') {
        wrapperVokasional.classList.remove('hidden');
    } else {
        wrapperVokasional.classList.add('hidden');
    }
}

function toggleInitAsramaOption(isPengasuh) {
    const wrapperAsrama = document.getElementById('init-wrapper-asrama');
    if (isPengasuh) {
        wrapperAsrama.classList.remove('hidden');
    } else {
        wrapperAsrama.classList.add('hidden');
    }
}

function saveInitPegawai(e) {
    e.preventDefault();
    const fotoInput = document.getElementById('init-pegawai-foto');
    if (!fotoInput.files || !fotoInput.files[0]) {
        alert('Foto pegawai wajib diunggah!');
        return;
    }

    compressImage(fotoInput.files[0], (fotoBase64) => {
        const newPegId = 'PEG_' + currentUser.username;
        const jabatanVal = document.getElementById('init-pegawai-jabatan').value;
        const isPengasuhChecked = document.querySelector('input[name="init-is-pengasuh"]:checked').value === 'ya';

        const newPeg = normalizePegawaiRecord({
            id: newPegId,
            nama: document.getElementById('init-pegawai-nama').value,
            nip: document.getElementById('init-pegawai-nip').value,
            jabatan: jabatanVal,
            pokja: document.getElementById('init-pegawai-pokja').value,
            vokasional: jabatanVal === 'Instruktur' ? document.getElementById('init-pegawai-vokasional').value : '',
            asrama: isPengasuhChecked ? document.getElementById('init-pegawai-asrama').value : '',
            pengasuhAsrama: isPengasuhChecked,
            foto: fotoBase64,
            createdByAccount: currentUser.username
        });

        const existingIndex = dataPegawai.findIndex(p => p.id === newPegId);
        if (existingIndex >= 0) {
            dataPegawai[existingIndex] = newPeg;
        } else {
            dataPegawai.push(newPeg);
        }

        usersDB[currentUser.username].pegawaiId = newPegId;
        currentUser.pegawaiId = newPegId;
        localStorage.setItem('sh_logged_user', JSON.stringify(currentUser));

        saveData();
        renderPegawaiTable();
        updateDropdownOptions();
        updateJurnalSubTitle();
        updateAdminUI();

        document.getElementById('login-screen').classList.add('hidden');
        const userLabel = document.getElementById('logged-username-label');
        if (userLabel) userLabel.innerText = currentUser.username;

        switchTab('pm');
        refreshSessionExpiry();
        addSystemLog('Pendaftaran Pegawai', `Petugas ${newPeg.nama} (${newPeg.jabatan}) mendaftarkan profil.`);
        showToast('Data pegawai berhasil didaftarkan! Selamat datang di Dashboard PM.');
    });
}

async function saveData() {
    const statusEl = document.getElementById('sync-status');
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("GANTI_DENGAN")) {
        showToast('Data disimpan lokal.');
        return;
    }

    // Tunda polling agar respons GET lama tidak menimpa data yang baru disimpan.
    pollingPausedUntil = Date.now() + 12000;

    try {
        statusEl.className = "text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
        statusEl.innerHTML = `<i class="fa-solid fa-rotate animate-spin"></i> Menyimpan ke Cloud...`;

        const payload = {
            pm: dataPM,
            pegawai: dataPegawai,
            perkembangan: dataPerkembangan,
            usersDB: usersDB,
            pwdRequests: pwdRequests
        };

        await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        });

        statusEl.className = "text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
        statusEl.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Terhubung ke Cloud`;
    } catch (error) {
        console.error("Gagal menyimpan:", error);
        statusEl.className = "text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
        statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Gagal Menyimpan`;
    }
}

async function loadDataFromCloud() {
    if (Date.now() < pollingPausedUntil) return;

    const statusEl = document.getElementById('sync-status');
    const urlReady = APPS_SCRIPT_URL && !APPS_SCRIPT_URL.includes("GANTI_DENGAN");

    if (!urlReady) {
        if (statusEl) {
            statusEl.className = "text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
            statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> URL Belum Diset`;
        }
        if (dataPM.length === 0 && dataPegawai.length === 0 && dataPerkembangan.length === 0) {
            initDefaultData();
        }
        refreshAllViews();
        return;
    }

    try {
        const response = await fetch(APPS_SCRIPT_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();
        if (!result || !Array.isArray(result.pm)) throw new Error('Format data tidak dikenali');

        const previousCount = dataPerkembangan.length;

        dataPM = result.pm.map(normalizePMRecord);
        dataPegawai = dedupeById((result.pegawai || []).map(normalizePegawaiRecord));
        dataPerkembangan = (result.perkembangan || []).map(normalizePerkembanganRecord);

        if (result.usersDB) usersDB = Object.assign(usersDB, result.usersDB);
        if (Array.isArray(result.pwdRequests)) pwdRequests = result.pwdRequests;

        // Sinkronkan objek sesi dengan data akun terbaru dari cloud.
        if (currentUser && usersDB[currentUser.username]) {
            currentUser = usersDB[currentUser.username];
            const userLabel = document.getElementById('logged-username-label');
            if (userLabel) userLabel.innerText = currentUser.username;
        }

        isCloudDataLoaded = true;

        if (previousCount > 0 && dataPerkembangan.length > previousCount) {
            showToast(`Ada ${dataPerkembangan.length - previousCount} catatan rekam perkembangan baru masuk!`);
            const newBadge = document.getElementById('perkembangan-new-badge');
            if (newBadge) newBadge.classList.remove('hidden');
            addSystemLog('Data Baru', `Masuk ${dataPerkembangan.length - previousCount} catatan rekam perkembangan baru.`);
        }

        if (statusEl) {
            statusEl.className = "text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
            statusEl.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Terhubung ke Cloud`;
        }
    } catch (error) {
        console.error("Gagal memuat data:", error);
        if (statusEl) {
            statusEl.className = "text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
            statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Gagal Sinkronisasi`;
        }
        // Jangan menimpa data yang sudah tampil hanya karena gangguan jaringan sesaat.
        if (!isCloudDataLoaded && dataPM.length === 0 && dataPegawai.length === 0 && dataPerkembangan.length === 0) {
            initDefaultData();
        }
    }

    const signature = computeDataSignature();
    if (signature !== lastDataSignature) {
        lastDataSignature = signature;
        refreshAllViews();
    }
}

function refreshAllViews() {
    renderPMTable();
    renderPegawaiTable();
    renderPerkembanganTable();
    if (currentUser && currentUser.role === 'admin') {
        renderPwdRequestsTable();
    }
    updateJurnalSubTitle();
    updateAdminUI();
    updateDashboardKPIs();
    renderCharts();
    updateNotificationWidget();
}

function initDefaultData() {
    dataPM = [normalizePMRecord({
        id: 'PM001', nama: 'Ananda Rizky', ibu: 'Siti Aminah', jk: 'Laki - Laki', kasus: 'ABH',
        vokasional: 'Vokasional TIK', asrama: 'Asrama R.A Kartini', status: 'Titipan',
        peksos: 'Budi Santoso, S.Tr.Sos', masuk: '2024-01-15', terminasi: '2024-07-15',
        foto: '', createdByAccount: 'user1'
    })];
    dataPegawai = [
        normalizePegawaiRecord({ id: 'PEG001', nama: 'Budi Santoso, S.Tr.Sos', nip: '198503122010011005', jabatan: 'Pekerja Sosial', pokja: 'Pokja ABH', vokasional: '', asrama: '', foto: '', createdByAccount: 'user1' }),
        normalizePegawaiRecord({ id: 'PEG002', nama: 'Moch. Sugito, S.T.', nip: '199205262025061002', jabatan: 'Instruktur', pokja: 'Pokja Residensial', vokasional: 'Vokasional TIK', asrama: '', foto: '', createdByAccount: 'admin' }),
        normalizePegawaiRecord({ id: 'PEG003', nama: 'Drs. Ahmad Hidayat, M.Si', nip: '197501011999031001', jabatan: 'Ketua Pokja', pokja: 'Pokja ABH', vokasional: '', asrama: '', foto: '', createdByAccount: 'admin' })
    ];
    dataPerkembangan = [normalizePerkembanganRecord({
        id: 'PER001', pmId: 'PM001', tanggal: '2024-01-20', kategori: 'Perilaku & Disiplin',
        deskripsi: 'PM mulai menyesuaikan diri.', rekomendasi: 'Konseling rutin.',
        petugas: 'Budi Santoso, S.Tr.Sos', foto: '', createdByAccount: 'user1'
    })];
}

function canUserModify(itemOwnerUsername, itemNip = null, itemId = null) {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;

    const owner = str(itemOwnerUsername);
    if (owner && owner === currentUser.username) return true;
    if (itemNip && str(itemNip) === '199205262025061002') return true;

    // Profil pegawai bisa saja tersimpan tanpa createdByAccount; cek keterikatan pegawaiId akun.
    if (itemId) {
        const account = usersDB[currentUser.username] || currentUser;
        if (account && account.pegawaiId && str(account.pegawaiId) === str(itemId)) return true;
        const myPegawai = getMyPegawai();
        if (myPegawai && str(myPegawai.id) === str(itemId)) return true;
    }

    return false;
}

/* POP-UP DETAIL PENERIMA MANFAAT */
function openViewPMModal(id) {
    const pm = dataPM.find(p => str(p.id) === str(id));
    if (!pm) {
        showToast('Data Penerima Manfaat tidak ditemukan.');
        return;
    }

    document.getElementById('view-pm-nama').innerText = pm.nama || '-';
    document.getElementById('view-pm-ibu').innerText = `Nama Ibu: ${pm.ibu || '-'}`;
    document.getElementById('view-pm-jk').innerText = pm.jk || '-';
    document.getElementById('view-pm-kasus').innerText = pm.kasus || '-';
    document.getElementById('view-pm-status').innerText = pm.status || '-';
    document.getElementById('view-pm-vokasional').innerText = pm.vokasional || 'Tidak Ada';
    document.getElementById('view-pm-asrama').innerText = pm.asrama || 'Non-Residensial';
    document.getElementById('view-pm-peksos').innerText = pm.peksos || '-';
    document.getElementById('view-pm-masuk').innerText = formatDateOnly(pm.masuk);
    document.getElementById('view-pm-terminasi').innerText = pm.terminasi ? formatDateOnly(pm.terminasi) : 'Belum Ditentukan';

    const imgEl = document.getElementById('view-pm-foto');
    const fallbackEl = document.getElementById('view-pm-foto-fallback');
    if (fallbackEl) fallbackEl.innerText = safeInitial(pm.nama);
    if (imgEl) {
        if (isUsablePhoto(pm.foto)) {
            imgEl.src = pm.foto;
            imgEl.classList.remove('hidden');
            imgEl.onerror = () => imgEl.classList.add('hidden');
        } else {
            imgEl.removeAttribute('src');
            imgEl.classList.add('hidden');
        }
    }

    document.getElementById('modal-view-pm').classList.remove('hidden');
}

function closeViewPMModal() {
    document.getElementById('modal-view-pm').classList.add('hidden');
}

function renderPMTable() {
    const tbody = document.getElementById('pm-table-body');
    if (!tbody) return;

    refreshDynamicOptions();

    const searchInput = document.getElementById('search-pm');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filtered = dataPM.filter(pm => {
        const haystack = [
            pm.nama, pm.ibu, pm.kasus, pm.vokasional, pm.asrama, pm.status, pm.peksos, pm.createdByAccount
        ].map(str).join(' ').toLowerCase();
        return !search || haystack.includes(search);
    });

    filtered.sort((a, b) => {
        const dateA = parseDateSafe(a.masuk);
        const dateB = parseDateSafe(b.masuk);
        if (dateA && dateB && dateA.getTime() !== dateB.getTime()) return dateB - dateA;
        return str(a.nama).localeCompare(str(b.nama));
    });

    lastFilteredPMList = filtered;

    const totalEl = document.getElementById('total-pm-count');
    if (totalEl) totalEl.innerText = filtered.length;

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-10 text-center text-slate-400 italic font-medium">
            <i class="fa-solid fa-folder-open text-3xl mb-2 block text-slate-300"></i>
            ${search ? 'Tidak ada Penerima Manfaat yang cocok dengan pencarian.' : 'Belum ada data Penerima Manfaat. Klik "Tambah PM Baru" untuk memulai.'}
        </td></tr>`;
        updateDashboardKPIs();
        renderCharts();
        return;
    }

    filtered.forEach(pm => {
        const isEditable = canUserModify(pm.createdByAccount, null);
        const tr = document.createElement('tr');
        tr.className = "hover:bg-indigo-50/70 transition border-b border-slate-100 cursor-pointer";

        tr.onclick = (e) => {
            if (!e.target.closest('button')) {
                openViewPMModal(pm.id);
            }
        };

        tr.innerHTML = `
            <td class="p-3.5">
                ${photoThumbHtml(pm.foto, pm.nama, 'w-12 h-14', 'rounded-lg shadow-sm')}
            </td>
            <td class="p-3.5 font-bold text-slate-900">${esc(pm.nama) || '-'}<br><span class="text-[11px] text-slate-400 font-normal">Ibu: ${esc(pm.ibu) || '-'}</span></td>
            <td class="p-3.5 hidden md:table-cell"><span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full font-bold text-[11px]"><i class="fa-solid fa-graduation-cap mr-1"></i>${esc(pm.vokasional) || '-'}</span></td>
            <td class="p-3.5 hidden lg:table-cell"><span class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full font-bold text-[11px]"><i class="fa-solid fa-house-chimney mr-1"></i>${esc(pm.asrama) || 'Tidak Ada'}</span></td>
            <td class="p-3.5 hidden sm:table-cell"><span class="px-2.5 py-1 bg-rose-50 text-rose-700 rounded-full font-bold text-[11px]">${esc(pm.kasus) || '-'}</span></td>
            <td class="p-3.5 hidden sm:table-cell"><span class="px-2.5 py-1 ${pm.status === 'Putusan' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'} rounded-full font-bold text-[11px]">${esc(pm.status) || '-'}</span></td>
            <td class="p-3.5 hidden xl:table-cell text-slate-700 font-medium">${esc(pm.peksos) || '-'}</td>
            <td class="p-3.5 hidden xl:table-cell text-[11px] font-mono text-slate-500 font-semibold">${esc(pm.createdByAccount) || '-'}</td>
            <td class="p-3.5 hidden lg:table-cell text-slate-600 font-medium">${formatDate(pm.masuk)}</td>
            <td class="p-3.5 hidden xl:table-cell text-slate-600 font-medium">${formatDate(pm.terminasi)}</td>
            <td class="p-3.5 text-center">
                <div class="flex items-center justify-center space-x-2">
                    ${isEditable ? `
                        <button onclick="editPM('${esc(pm.id)}')" class="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition shadow-sm" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="deletePM('${esc(pm.id)}')" class="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition shadow-sm" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                    ` : `<span class="text-[11px] text-slate-400 font-medium bg-slate-100 px-2 py-1 rounded-lg"><i class="fa-solid fa-lock mr-1"></i> Locked</span>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDashboardKPIs();
    renderCharts();
}

/* POP-UP DETAIL PEGAWAI & PROFIL PRIBADI */
function openViewPegawaiModal(id) {
    const peg = dataPegawai.find(p => str(p.id) === str(id));
    if (!peg) {
        showToast('Data pegawai tidak ditemukan.');
        return;
    }

    document.getElementById('view-pegawai-nama').innerText = peg.nama || '-';
    document.getElementById('view-pegawai-nip').innerText = `NIP. ${peg.nip || '-'}`;
    document.getElementById('view-pegawai-jabatan').innerText = peg.jabatan || '-';
    document.getElementById('view-pegawai-pokja').innerText = peg.pokja || '-';
    document.getElementById('view-pegawai-akun').innerText = findLinkedAccount(peg) || '-';

    const imgEl = document.getElementById('view-pegawai-foto');
    const fallbackEl = document.getElementById('view-pegawai-foto-fallback');
    const hintEl = document.getElementById('view-pegawai-foto-hint');
    if (fallbackEl) fallbackEl.innerText = safeInitial(peg.nama);
    if (imgEl) {
        if (isUsablePhoto(peg.foto)) {
            imgEl.src = peg.foto;
            imgEl.classList.remove('hidden');
            imgEl.onerror = () => imgEl.classList.add('hidden');
        } else {
            imgEl.removeAttribute('src');
            imgEl.classList.add('hidden');
        }
    }
    if (hintEl) {
        hintEl.innerText = isUsablePhoto(peg.foto) ? '' : 'Belum ada foto profil';
    }

    const wrapperVok = document.getElementById('view-wrapper-vokasional');
    if (peg.vokasional) {
        document.getElementById('view-pegawai-vokasional').innerText = peg.vokasional;
        wrapperVok.classList.remove('hidden');
    } else {
        wrapperVok.classList.add('hidden');
    }

    const wrapperAsrama = document.getElementById('view-wrapper-asrama');
    if (peg.asrama) {
        document.getElementById('view-pegawai-asrama').innerText = peg.asrama;
        wrapperAsrama.classList.remove('hidden');
    } else {
        wrapperAsrama.classList.add('hidden');
    }

    const editBtnContainer = document.getElementById('view-pegawai-edit-btn-container');
    if (editBtnContainer) {
        if (canUserModify(peg.createdByAccount, peg.nip, peg.id)) {
            editBtnContainer.innerHTML = `<button onclick="closeViewPegawaiModal(); editPegawai('${esc(peg.id)}');" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs transition shadow"><i class="fa-solid fa-pen-to-square mr-1"></i> Edit Profil Ini</button>`;
        } else {
            editBtnContainer.innerHTML = `<span class="text-xs text-slate-400 italic">Profil terkunci (Hanya dapat diedit oleh pembuat akun)</span>`;
        }
    }

    document.getElementById('modal-view-pegawai').classList.remove('hidden');
}

function closeViewPegawaiModal() {
    document.getElementById('modal-view-pegawai').classList.add('hidden');
}

function openMyProfileModal() {
    if (!currentUser) return;
    if (currentUser.role === 'admin') {
        alert('Akun Master Admin tidak memerlukan profil pegawai.');
        return;
    }

    const myPegawai = getMyPegawai();
    if (myPegawai) {
        openViewPegawaiModal(myPegawai.id);
    } else {
        alert('Anda belum mendaftarkan profil pegawai untuk akun ini.');
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('login-box').classList.add('hidden');
        document.getElementById('pegawai-init-box').classList.remove('hidden');
        toggleInitConditionalFields();
    }
}

function renderPegawaiTable() {
    const tbody = document.getElementById('pegawai-table-body');
    if (!tbody) return;

    refreshDynamicOptions();

    const searchInput = document.getElementById('search-pegawai');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filterJabatanSelect = document.getElementById('filter-jabatan-pegawai');
    const filterJabatan = filterJabatanSelect ? filterJabatanSelect.value : '';

    const filterPokjaSelect = document.getElementById('filter-pokja-pegawai');
    const filterPokja = filterPokjaSelect ? filterPokjaSelect.value : '';

    const totalPegawai = dataPegawai.length;
    const jabatanCounts = {};
    const pokjaCounts = {};

    dataPegawai.forEach(peg => {
        const jabatan = peg.jabatan || 'Lainnya';
        const pokja = peg.pokja || 'Umum';
        jabatanCounts[jabatan] = (jabatanCounts[jabatan] || 0) + 1;
        pokjaCounts[pokja] = (pokjaCounts[pokja] || 0) + 1;
    });

    const totalEl = document.getElementById('stat-total-pegawai');
    if (totalEl) totalEl.innerText = totalPegawai;

    const statJabatanList = document.getElementById('stat-jabatan-list');
    if (statJabatanList) {
        statJabatanList.innerHTML = Object.keys(jabatanCounts).length
            ? Object.keys(jabatanCounts).map(jab => `
                <div class="flex justify-between items-center py-0.5 border-b border-slate-100">
                    <span class="font-medium text-slate-600">${esc(jab)}:</span>
                    <span class="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">${jabatanCounts[jab]}</span>
                </div>
            `).join('')
            : `<p class="text-slate-400 italic">Belum ada data.</p>`;
    }

    const statPokjaList = document.getElementById('stat-pokja-list');
    if (statPokjaList) {
        statPokjaList.innerHTML = Object.keys(pokjaCounts).length
            ? Object.keys(pokjaCounts).map(pok => `
                <div class="flex justify-between items-center py-0.5 border-b border-slate-100">
                    <span class="font-medium text-slate-600">${esc(pok)}:</span>
                    <span class="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">${pokjaCounts[pok]}</span>
                </div>
            `).join('')
            : `<p class="text-slate-400 italic">Belum ada data.</p>`;
    }

    const filteredPegawai = dataPegawai.filter(peg => {
        const haystack = [
            peg.nama, peg.nip, peg.jabatan, peg.pokja, peg.vokasional, peg.asrama,
            findLinkedAccount(peg)
        ].map(str).join(' ').toLowerCase();

        const matchSearch = !search || haystack.includes(search);
        const matchJabatan = filterJabatan ? peg.jabatan === filterJabatan : true;
        const matchPokja = filterPokja ? peg.pokja === filterPokja : true;

        return matchSearch && matchJabatan && matchPokja;
    });

    filteredPegawai.sort((a, b) => str(a.nama).localeCompare(str(b.nama)));
    lastFilteredPegawaiList = filteredPegawai;

    const countFilteredEl = document.getElementById('total-filtered-pegawai');
    if (countFilteredEl) countFilteredEl.innerText = filteredPegawai.length;

    tbody.innerHTML = '';

    if (filteredPegawai.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-slate-400 italic font-medium">
            <i class="fa-solid fa-user-slash text-3xl mb-2 block text-slate-300"></i>
            ${(search || filterJabatan || filterPokja) ? 'Tidak ada pegawai yang cocok dengan filter pencarian.' : 'Belum ada data pegawai.'}
        </td></tr>`;
        updateDashboardKPIs();
        updateDropdownOptions();
        refreshAsramaEntryVisibility();
        return;
    }

    const isAdminView = currentUser && currentUser.role === 'admin';
    const accountOptions = isAdminView
        ? Object.values(usersDB)
            .filter(acc => acc.role !== 'admin')
            .sort((a, b) => str(a.username).localeCompare(str(b.username)))
        : [];

    filteredPegawai.forEach(peg => {
        const isEditable = canUserModify(peg.createdByAccount, peg.nip, peg.id);
        const linkedAccountName = findLinkedAccount(peg);

        let detailBadge = '';
        if (peg.vokasional) {
            detailBadge += `<br><span class="text-[11px] text-indigo-700 font-bold mt-0.5 inline-block"><i class="fa-solid fa-graduation-cap mr-1"></i> ${esc(peg.vokasional)}</span>`;
        }
        if (peg.asrama) {
            detailBadge += `<br><span class="text-[11px] text-amber-700 font-bold mt-0.5 inline-block"><i class="fa-solid fa-house-chimney mr-1"></i> Pengasuh: ${esc(peg.asrama)}</span>`;
        }

        const tr = document.createElement('tr');
        tr.className = "transition border-b border-slate-100 hover:bg-indigo-50/75 cursor-pointer";

        tr.onclick = (e) => {
            if (!e.target.closest('button, select, option, input')) {
                openViewPegawaiModal(peg.id);
            }
        };

        tr.innerHTML = `
            <td class="p-3.5">
                ${photoThumbHtml(peg.foto, peg.nama, 'w-12 h-12', 'shadow-sm')}
            </td>
            <td class="p-3.5 font-bold text-slate-900">${esc(peg.nama) || '-'}</td>
            <td class="p-3.5 text-slate-600 font-mono text-xs font-semibold hidden sm:table-cell">${esc(peg.nip) || '-'}</td>
            <td class="p-3.5">
                <span class="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">${esc(peg.jabatan) || '-'}</span>
                ${detailBadge}
            </td>
            <td class="p-3.5 text-slate-700 font-medium hidden md:table-cell">${esc(peg.pokja) || '-'}</td>
            <td class="p-3.5 hidden lg:table-cell">
                ${isAdminView ? `
                    <select onchange="linkAccountToPegawai('${esc(peg.id)}', this.value)" class="w-full max-w-[190px] px-2 py-1.5 border border-slate-300 rounded-xl text-[11px] font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" title="Hubungkan profil pegawai ini dengan akun user">
                        <option value="">-- Belum terhubung --</option>
                        ${accountOptions.map(acc => `<option value="${esc(acc.username)}" ${acc.username === linkedAccountName ? 'selected' : ''}>${esc(acc.username)}</option>`).join('')}
                    </select>
                ` : `
                    <span class="px-2.5 py-1 bg-slate-100 text-indigo-600 rounded-full text-xs font-mono font-bold">
                        <i class="fa-solid fa-link mr-1"></i> ${esc(linkedAccountName) || '-'}
                    </span>
                `}
            </td>
            <td class="p-3.5 text-center">
                <div class="flex items-center justify-center space-x-2">
                    ${isEditable ? `
                        <button onclick="editPegawai('${esc(peg.id)}')" class="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition shadow-sm" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="deletePegawai('${esc(peg.id)}')" class="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition shadow-sm" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                    ` : `<span class="text-[11px] text-slate-400 font-medium bg-slate-100 px-2.5 py-1 rounded-lg"><i class="fa-solid fa-lock mr-1"></i> Locked</span>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDashboardKPIs();
    updateDropdownOptions();
    refreshAsramaEntryVisibility();
}

function renderPerkembanganTable() {
    const tbody = document.getElementById('perkembangan-table-body');
    if (!tbody) return;

    refreshDynamicOptions();

    const filterPM = document.getElementById('filter-perkembangan-pm').value;
    const filterKategoriEl = document.getElementById('filter-kategori-perkembangan');
    const filterKategori = filterKategoriEl ? filterKategoriEl.value : '';
    const searchEl = document.getElementById('search-perkembangan');
    const search = searchEl ? searchEl.value.toLowerCase().trim() : '';

    let filtered = dataPerkembangan.slice();

    if (filterPM) filtered = filtered.filter(p => p.pmId === filterPM);
    if (filterKategori) filtered = filtered.filter(p => p.kategori === filterKategori);

    if (currentUser && currentUser.role !== 'admin') {
        filtered = filtered.filter(p => str(p.createdByAccount) === currentUser.username);
    }

    if (search) {
        filtered = filtered.filter(p => {
            const pm = dataPM.find(item => item.id === p.pmId);
            const haystack = [p.deskripsi, p.rekomendasi, p.kategori, p.petugas, p.createdByAccount, pm ? pm.nama : '']
                .map(str).join(' ').toLowerCase();
            return haystack.includes(search);
        });
    }

    filtered.sort((a, b) => {
        const dateA = parseDateSafe(a.tanggal);
        const dateB = parseDateSafe(b.tanggal);
        if (dateA && dateB) return dateB - dateA;
        return str(b.tanggal).localeCompare(str(a.tanggal));
    });

    lastFilteredPerkembanganList = filtered;

    const countEl = document.getElementById('total-perkembangan-count');
    if (countEl) countEl.innerText = filtered.length;

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-10 text-center text-slate-400 italic font-medium">
                    <i class="fa-solid fa-folder-open text-3xl mb-2 block text-slate-300"></i>
                    ${(search || filterPM || filterKategori) ? 'Tidak ada catatan yang cocok dengan filter.' : 'Belum ada catatan rekam perkembangan.'}
                </td>
            </tr>
        `;
        updateDashboardKPIs();
        return;
    }

    filtered.forEach(p => {
        const pm = dataPM.find(item => item.id === p.pmId) || { nama: 'PM Terhapus' };

        const petugasObj = dataPegawai.find(peg => peg.nama === p.petugas || `${peg.nama} (${peg.jabatan})` === p.petugas);
        const isKeamananRecord = petugasObj && petugasObj.jabatan === 'Petugas Keamanan';
        const hasAsramaInstrument = !!(p.penilaianAsrama && Array.isArray(p.penilaianAsrama.indikator));

        const isEditable = canUserModify(p.createdByAccount);
        const tr = document.createElement('tr');
        tr.className = "hover:bg-indigo-50/40 transition border-b border-slate-100";
        tr.innerHTML = `
            <td class="p-3.5 hidden sm:table-cell font-mono text-xs text-slate-600 font-medium">${formatDateWithTime(p.tanggal)}</td>
            <td class="p-3.5 font-bold text-slate-900">${esc(pm.nama)}</td>
            <td class="p-3.5">
                <span class="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-bold">${esc(p.kategori) || '-'}</span>
                ${hasAsramaInstrument ? `<br><span class="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-extrabold shadow-sm"><i class="fa-solid fa-clipboard-list"></i> Instrumen ${p.penilaianAsrama.total}/40</span>` : ''}
                ${isKeamananRecord ? `<br><span class="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded-full text-[10px] font-extrabold shadow-sm"><i class="fa-solid fa-shield-halved"></i> Petugas Keamanan</span>` : ''}
            </td>
            <td class="p-3.5 text-slate-700 max-w-xs font-medium leading-relaxed">
                ${hasAsramaInstrument
                    ? renderAsramaTableSummary(p)
                    : `<p class="whitespace-pre-line">${esc(p.deskripsi)}</p>`}
                ${isUsablePhoto(p.foto) ? `<div class="mt-2"><img src="${esc(p.foto)}" alt="Foto dokumentasi" class="max-w-[120px] max-h-[120px] rounded-lg object-cover border border-slate-200 shadow-sm cursor-zoom-in" onclick="openImagePreview(this.src)"></div>` : ''}
            </td>
            <td class="p-3.5 hidden xl:table-cell text-slate-600 max-w-xs font-medium">${esc(p.rekomendasi) || '-'}</td>
            <td class="p-3.5 hidden md:table-cell text-slate-700 font-semibold">${esc(p.petugas) || '-'}</td>
            <td class="p-3.5 hidden lg:table-cell text-[11px] font-mono text-slate-500 font-semibold">${esc(p.createdByAccount) || '-'}</td>
            <td class="p-3.5 text-center">
                <div class="flex items-center justify-center space-x-2">
                    ${hasAsramaInstrument && canUseAsramaAssessment() ? `
                        <button onclick="printAsramaAssessment('${esc(p.id)}')" class="p-2 bg-amber-50 text-amber-600 rounded-xl hover:bg-amber-100 transition shadow-sm" title="Ekspor PDF Instrumen Asrama"><i class="fa-solid fa-file-pdf"></i></button>
                    ` : ''}
                    ${isEditable ? `
                        <button onclick="editPerkembangan('${esc(p.id)}')" class="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition shadow-sm" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="deletePerkembangan('${esc(p.id)}')" class="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition shadow-sm" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                    ` : `<span class="text-[11px] text-slate-400 font-medium bg-slate-100 px-2 py-1 rounded-lg"><i class="fa-solid fa-lock mr-1"></i> Locked</span>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDashboardKPIs();
}

// --- KATEGORI PERKEMBANGAN TERMASUK PENILAIAN ASRAMA BULANAN UNTUK PENGASUH ---
const KATEGORI_PENILAIAN = [
    'Perilaku & Disiplin',
    'Penilaian Asrama Bulanan',
    'Kesehatan Mental & Psikologis',
    'Kesehatan Fisik & Medis',
    'Keagamaan & Kerohanian',
    'Interaksi Sosial',
    'Keterampilan',
    'Vokasional'
];

function normalizeJabatan(jabatan) {
    return str(jabatan).toLowerCase().replace(/\s+/g, ' ').trim();
}

function getKategoriPenilaianByJabatan(jabatan) {
    const key = normalizeJabatan(jabatan);
    if (!key) return KATEGORI_PENILAIAN.slice();

    if (key.includes('instruktur')) return ['Vokasional'];
    if (key.includes('pengasuh')) return ['Perilaku & Disiplin', 'Penilaian Asrama Bulanan'];
    if (key.includes('keamanan')) return ['Perilaku & Disiplin'];
    if (key.includes('psikolog')) return ['Kesehatan Mental & Psikologis'];
    if (key.includes('dokter') || key.includes('perawat') || key.includes('fisioterapi')) {
        return ['Kesehatan Fisik & Medis'];
    }
    if (key.includes('ketua pokja')) return KATEGORI_PENILAIAN.slice();
    // Pekerja Sosial Pendamping menilai semua unsur kecuali asrama dan vokasional.
    if (key.includes('pekerja sosial') || key.includes('pendamping sosial') || key === 'pendamping') {
        return KATEGORI_PENILAIAN.filter(kategori => kategori !== 'Penilaian Asrama Bulanan' && kategori !== 'Vokasional');
    }
    return ['Perilaku & Disiplin', 'Penilaian Asrama Bulanan', 'Interaksi Sosial', 'Keterampilan'];
}

/* --- INSTRUMEN PENILAIAN ASRAMA (mengacu "Instrumen Perkembangan PM di Asrama") --- */
const ASRAMA_KATEGORI = 'Penilaian Asrama Bulanan';
const ASRAMA_PENANGGUNG_PENGASUHAN = 'Martin Hamonangan';
const ASRAMA_INDIKATOR = [
    { key: 'ibadah', nama: 'Ibadah & Mental Spiritual', deskripsi: 'Kedisiplinan ibadah harian, partisipasi pembinaan rohani dan bimbingan mental' },
    { key: 'kebersihan', nama: 'Kebersihan & Kerapihan Asrama', deskripsi: 'Merawat kebersihan kamar, tempat tidur, pakaian pribadi dan area bersama' },
    { key: 'kejujuran', nama: 'Kejujuran & Integritas', deskripsi: 'Keterbukaan dalam berinteraksi, tidak mengambil milik orang lain, mengakui kesalahan' },
    { key: 'etika', nama: 'Etika & Sopan Santun', deskripsi: 'Penggunaan bahasa yang santun, sikap menghormati pengasuh, Peksos, dan teman sebaya' },
    { key: 'kemandirian', nama: 'Inisiatif & Kemandirian (Life Skills)', deskripsi: 'Kemampuan mengurus diri sendiri, jadwal kegiatan harian tanpa selalu diperintah' },
    { key: 'kedisiplinan', nama: 'Kedisiplinan & Kepatuhan Jadwal', deskripsi: 'Tepat waktu bangun pagi, makan, mengikuti kegiatan, kembali ke asrama dan jam tidur malam' },
    { key: 'tanggung_jawab', nama: 'Tanggung Jawab Tugas Asrama', deskripsi: 'Pelaksanaan piket kebersihan, menjaga fasilitas asrama, serta kepatuhan aturan' },
    { key: 'interpersonal', nama: 'Hubungan Interpersonal', deskripsi: 'Adaptasi lingkungan, tidak berkonflik, dan aktif berpartisipasi dalam kelompok' },
    { key: 'kepatuhan', nama: 'Kepatuhan dan Respon Pada Petugas', deskripsi: 'Sikap kooperatif terhadap pengasuh, mengikuti arahan bimbingan dan terapi' },
    { key: 'regulasi_emosi', nama: 'Regulasi Emosi & Resiliensi', deskripsi: 'Kemampuan mengontrol emosi dan menyelesaikan masalah pribadi secara baik' }
];
const ASRAMA_SKALA = [
    { nilai: 1, label: 'Sangat Kurang', deskripsi: 'PM menolak aturan, belum menunjukkan kemauan berubah atau membutuhkan pengawasan ketat dan intervensi intensif dari pengasuh.' },
    { nilai: 2, label: 'Kurang', deskripsi: 'Menunjukkan kesadaran sesekali, namun masih sering melakukan pelanggaran/hambatan dan memerlukan arahan berulang-ulang.' },
    { nilai: 3, label: 'Baik', deskripsi: 'PM mampu menjalankan aktivitas dan tata tertib asrama secara mandiri dengan sedikit arahan.' },
    { nilai: 4, label: 'Sangat Baik', deskripsi: 'Konsisten menjalankan norma, disiplin, dan etika, serta mampu menjadi teladan bagi rekan sebaya di asrama.' }
];
const ASRAMA_LAYANAN = [
    'Dukungan pemenuhan hidup layak: kebutuhan nutrisi, kelengkapan alat bersih diri dan kelayakan kamar asrama',
    'Perawatan sosial & pengasuhan: pendampingan 24 jam dan pengayoman oleh pengasuh asrama',
    'Terapi fisik & kesehatan: olahraga rutin, kebugaran jasmani dan penanganan medis',
    'Terapi psikososial & mental spiritual: konseling individu/kelompok, terapi, bimbingan keagamaan',
    'Pelatihan vokasional & kewirausahaan: keterampilan kerja dan pengenalan ke Sentra Kreasi'
];
const ASRAMA_KEBERFUNGSIAN = [
    'Belum Mandiri (memerlukan pendampingan penuh)',
    'Mandiri Sebagian (memerlukan bimbingan berkala)',
    'Mandiri Penuh (siap untuk terminasi/reunifikasi)'
];
const ASRAMA_TINDAK_LANJUT = [
    'Melanjutkan layanan residensial di asrama',
    'Rencana terminasi / pengembalian ke keluarga/masyarakat',
    'Rujukan ke layanan / lembaga lain'
];
const ASRAMA_KLASTER_OPTIONS = [
    'ABH',
    'Korban Ekstrimisme',
    'SKB',
    'Korban Penyalahgunaan NAPZA',
    'ODHIV',
    'Kelompok Rentan',
    'Korban Kekerasan Seksual',
    'Anak Tidak Terdokumentasi',
    'Korban Bullying',
    'True Crime Community',
    'TPPO',
    'Lanjut Usia'
];
const ASRAMA_KLASTER_BY_KASUS = [
    { tokens: ['abh'], klaster: 'ABH' },
    { tokens: ['ekstrimisme', 'ektrimisme', 'terorisme'], klaster: 'Korban Ekstrimisme' },
    { tokens: ['skb'], klaster: 'SKB' },
    { tokens: ['napza', 'penyalahgunaan'], klaster: 'Korban Penyalahgunaan NAPZA' },
    { tokens: ['odhiv', 'hiv'], klaster: 'ODHIV' },
    { tokens: ['kekerasan seksual'], klaster: 'Korban Kekerasan Seksual' },
    { tokens: ['tidak terdokumentasi'], klaster: 'Anak Tidak Terdokumentasi' },
    { tokens: ['bullying', 'perundungan'], klaster: 'Korban Bullying' },
    { tokens: ['true crime'], klaster: 'True Crime Community' },
    { tokens: ['tppo', 'perdagangan orang'], klaster: 'TPPO' },
    { tokens: ['lanjut usia', 'lansia'], klaster: 'Lanjut Usia' },
    { tokens: ['kelompok rentan', 'rentan'], klaster: 'Kelompok Rentan' }
];

function getAsramaKlasterFromKasus(kasus) {
    const key = str(kasus).toLowerCase();
    if (!key) return '';
    const found = ASRAMA_KLASTER_BY_KASUS.find(entry => entry.tokens.some(token => key.includes(token)));
    return found ? found.klaster : '';
}

function normalizeAsramaKlaster(value) {
    const text = normalizeKasusPM(value);
    if (!text) return '';
    const exact = ASRAMA_KLASTER_OPTIONS.find(opt => opt.toLowerCase() === text.toLowerCase());
    if (exact) return exact;
    return getAsramaKlasterFromKasus(text);
}

function isPengasuhAsrama(peg) {
    if (!peg) return false;
    if (peg.pengasuhAsrama === true) return true;
    // Profil lama belum menyimpan penanda pengasuhAsrama; penugasan asrama
    // (yang hanya diisi lewat pertanyaan "Pengasuh Asrama Residensial?") menjadi penandanya.
    return !!str(peg.asrama).trim();
}

function canUseAsramaAssessment() {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;

    const account = usersDB[currentUser.username] || currentUser;
    return dataPegawai.some(peg => isPegawaiLinkedToAccount(peg, account) && isPengasuhAsrama(peg));
}

function refreshAsramaEntryVisibility() {
    const btn = document.getElementById('btn-penilaian-asrama');
    if (!btn) return;
    if (canUseAsramaAssessment()) {
        btn.classList.remove('hidden');
        btn.classList.add('flex');
    } else {
        btn.classList.add('hidden');
        btn.classList.remove('flex');
    }
}

function getAsramaPengasuhName(pm) {
    const myPegawai = getMyPegawai();
    if (currentUser && currentUser.role !== 'admin' && myPegawai && isPengasuhAsrama(myPegawai)) {
        return myPegawai.nama;
    }
    if (pm && pm.asrama) {
        const pengasuh = dataPegawai.find(peg =>
            isSameAsrama(peg.asrama, pm.asrama) && isPengasuhAsrama(peg));
        if (pengasuh) return pengasuh.nama;
        const petugasAsrama = dataPegawai.find(peg => isSameAsrama(peg.asrama, pm.asrama));
        if (petugasAsrama) return petugasAsrama.nama;
    }
    return '';
}

function getAsramaPredikat(rataRata) {
    if (rataRata >= 3.5) return { label: 'Sangat Baik', tone: 'emerald' };
    if (rataRata >= 2.5) return { label: 'Baik', tone: 'sky' };
    if (rataRata >= 1.5) return { label: 'Kurang', tone: 'amber' };
    return { label: 'Sangat Kurang', tone: 'rose' };
}

function getAsramaNilaiBadgeClass(nilai) {
    if (nilai >= 4) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (nilai === 3) return 'bg-sky-100 text-sky-800 border-sky-300';
    if (nilai === 2) return 'bg-amber-100 text-amber-800 border-amber-300';
    return 'bg-rose-100 text-rose-800 border-rose-300';
}

function getAsramaScaleButtonClass(nilai) {
    if (nilai === 4) return 'peer-checked:bg-emerald-600 peer-checked:border-emerald-600';
    if (nilai === 3) return 'peer-checked:bg-sky-600 peer-checked:border-sky-600';
    if (nilai === 2) return 'peer-checked:bg-amber-500 peer-checked:border-amber-500';
    return 'peer-checked:bg-rose-600 peer-checked:border-rose-600';
}

function renderAsramaFormFields() {
    const indicatorBody = document.getElementById('asrama-indikator-body');
    if (indicatorBody) {
        indicatorBody.innerHTML = ASRAMA_INDIKATOR.map((ind, index) => `
            <tr class="align-top border-b border-slate-100">
                <td class="p-2 text-center font-bold text-slate-400">${index + 1}</td>
                <td class="p-2">
                    <p class="font-bold text-slate-800 leading-snug">${esc(ind.nama)}</p>
                    <p class="text-[11px] text-slate-500 leading-snug mt-0.5">${esc(ind.deskripsi)}</p>
                </td>
                <td class="p-2">
                    <div class="grid grid-cols-4 gap-1">
                        ${ASRAMA_SKALA.map(skala => `
                            <label class="cursor-pointer" title="${esc(skala.label)}">
                                <input type="radio" name="asrama-nilai-${ind.key}" value="${skala.nilai}" onchange="updateAsramaScoreSummary()" class="peer sr-only">
                                <span class="block text-center py-2 rounded-lg border border-slate-200 bg-white text-slate-600 font-bold text-xs transition peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 ${getAsramaScaleButtonClass(skala.nilai)} peer-checked:text-white">${skala.nilai}</span>
                            </label>
                        `).join('')}
                    </div>
                </td>
                <td class="p-2">
                    <textarea data-asrama-catatan="${ind.key}" rows="2" placeholder="Catatan perilaku & intervensi..." class="w-full border border-slate-200 rounded-lg p-2 text-[11px] focus:ring-2 focus:ring-indigo-500 outline-none"></textarea>
                </td>
            </tr>
        `).join('');
    }

    const legend = document.getElementById('asrama-legend');
    if (legend) {
        legend.innerHTML = ASRAMA_SKALA.map(skala => `
            <div class="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span class="flex-none w-6 h-6 rounded-md border text-[11px] font-extrabold flex items-center justify-center ${getAsramaNilaiBadgeClass(skala.nilai)}">${skala.nilai}</span>
                <p class="text-[11px] leading-snug"><strong class="text-slate-800">${esc(skala.label)}:</strong> <span class="text-slate-600">${esc(skala.deskripsi)}</span></p>
            </div>
        `).join('');
    }

    const layananList = document.getElementById('asrama-layanan-list');
    if (layananList) {
        layananList.innerHTML = ASRAMA_LAYANAN.map(item => `
            <label class="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 cursor-pointer transition">
                <input type="checkbox" data-asrama-layanan value="${esc(item)}" class="mt-0.5 w-4 h-4 accent-indigo-600 flex-none">
                <span class="text-[11px] text-slate-700 leading-snug">${esc(item)}</span>
            </label>
        `).join('');
    }

    const keberfungsianList = document.getElementById('asrama-keberfungsian-list');
    if (keberfungsianList) {
        keberfungsianList.innerHTML = ASRAMA_KEBERFUNGSIAN.map(item => `
            <label class="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 cursor-pointer transition">
                <input type="radio" name="asrama-keberfungsian" value="${esc(item)}" class="mt-0.5 w-4 h-4 accent-indigo-600 flex-none">
                <span class="text-[11px] text-slate-700 leading-snug">${esc(item)}</span>
            </label>
        `).join('');
    }

    const tindakLanjutList = document.getElementById('asrama-tindak-lanjut-list');
    if (tindakLanjutList) {
        tindakLanjutList.innerHTML = ASRAMA_TINDAK_LANJUT.map(item => `
            <label class="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 cursor-pointer transition">
                <input type="radio" name="asrama-tindak-lanjut" value="${esc(item)}" class="mt-0.5 w-4 h-4 accent-indigo-600 flex-none">
                <span class="text-[11px] text-slate-700 leading-snug">${esc(item)}</span>
            </label>
        `).join('');
    }

    const klasterSelect = document.getElementById('asrama-klaster');
    if (klasterSelect) {
        klasterSelect.innerHTML = `<option value="">-- Pilih Klaster PM --</option>` +
            ASRAMA_KLASTER_OPTIONS.map(item => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
    }
}

function getAsramaFormValues() {
    return ASRAMA_INDIKATOR.map(ind => {
        const checked = document.querySelector(`input[name="asrama-nilai-${ind.key}"]:checked`);
        const catatan = document.querySelector(`[data-asrama-catatan="${ind.key}"]`);
        return {
            key: ind.key,
            nama: ind.nama,
            nilai: checked ? Number(checked.value) : 0,
            catatan: catatan ? catatan.value.trim() : ''
        };
    });
}

function updateAsramaScoreSummary() {
    const summary = document.getElementById('asrama-score-summary');
    if (!summary) return;

    const values = getAsramaFormValues();
    const filled = values.filter(item => item.nilai > 0);
    if (filled.length === 0) {
        summary.innerHTML = 'Total: - / 40';
        return;
    }

    const total = filled.reduce((sum, item) => sum + item.nilai, 0);
    const rataRata = total / values.length;
    const predikat = getAsramaPredikat(rataRata);
    summary.innerHTML = `Terisi ${filled.length}/10 · Total <span class="text-indigo-700 font-extrabold">${total}</span>/40 · Rata-rata ${rataRata.toFixed(2)} · <span class="text-${predikat.tone}-700 font-extrabold">${predikat.label}</span>`;
}

function toggleAsramaRadioGroup(name, value) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
        radio.checked = radio.value === value;
    });
}

function syncAsramaIdentityFields() {
    const pmId = document.getElementById('asrama-pm') ? document.getElementById('asrama-pm').value : '';
    const pm = dataPM.find(item => str(item.id) === str(pmId));
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '-';
    };

    if (!pm) {
        setValue('asrama-asrama', '-');
        setValue('asrama-peksos', '-');
        setValue('asrama-masuk', '-');
        const fallbackPengasuh = (currentUser && currentUser.role !== 'admin' && getMyPegawai()) ? getMyPegawai().nama : '';
        const pengasuhEl = document.getElementById('asrama-pengasuh');
        if (pengasuhEl) pengasuhEl.value = fallbackPengasuh;
        const klasterEl = document.getElementById('asrama-klaster');
        if (klasterEl) klasterEl.value = '';
        return;
    }

    setValue('asrama-asrama', pm.asrama || 'Non-Residensial');
    setValue('asrama-peksos', pm.peksos || '-');
    setValue('asrama-masuk', pm.masuk ? formatDateOnly(pm.masuk) : '-');

    const pengasuh = getAsramaPengasuhName(pm);
    const pengasuhEl = document.getElementById('asrama-pengasuh');
    if (pengasuhEl) pengasuhEl.value = pengasuh;

    const klasterEl = document.getElementById('asrama-klaster');
    if (klasterEl) klasterEl.value = normalizeAsramaKlaster(pm.kasus);
}

function openAsramaAssessmentModal(editId = null) {
    if (!canUseAsramaAssessment()) {
        alert('Form penilaian asrama hanya dapat digunakan oleh Pengasuh Asrama.');
        return;
    }

    const form = document.getElementById('form-penilaian-asrama');
    if (form) form.reset();

    document.getElementById('asrama-id').value = '';
    document.getElementById('asrama-klaster').value = '';
    document.getElementById('asrama-catatan').value = '';
    document.getElementById('btn-cetak-asrama').classList.add('hidden');
    document.getElementById('modal-penilaian-asrama-title').innerText = 'Instrumen Evaluasi & Perkembangan PM di Asrama';

    renderAsramaFormFields();

    const selectPM = document.getElementById('asrama-pm');
    const myPegawai = getMyPegawai();
    let listPM = dataPM.slice();
    if (currentUser && currentUser.role !== 'admin' && myPegawai && myPegawai.asrama) {
        listPM = listPM.filter(pm => isSameAsrama(pm.asrama, myPegawai.asrama));
    }
    selectPM.innerHTML = `<option value="">-- Pilih Penerima Manfaat --</option>` +
        listPM.map(pm => `<option value="${esc(pm.id)}">${esc(pm.nama)} - (${esc(pm.kasus)})</option>`).join('');

    const now = new Date();
    document.getElementById('asrama-tanggal').value =
        `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

    if (editId) {
        const rec = dataPerkembangan.find(p => str(p.id) === str(editId));
        const data = rec ? rec.penilaianAsrama : null;
        if (rec && data) {
            document.getElementById('asrama-id').value = rec.id;
            document.getElementById('btn-cetak-asrama').classList.remove('hidden');

            if (!Array.from(selectPM.options).some(opt => opt.value === str(rec.pmId))) {
                const pm = dataPM.find(item => str(item.id) === str(rec.pmId));
                if (pm) {
                    selectPM.insertAdjacentHTML('beforeend', `<option value="${esc(pm.id)}">${esc(pm.nama)} - (${esc(pm.kasus)})</option>`);
                }
            }
            selectPM.value = rec.pmId;
            document.getElementById('asrama-tanggal').value = toDateTimeLocalValue(rec.tanggal);

            (data.indikator || []).forEach(item => {
                if (!ASRAMA_INDIKATOR.some(ind => ind.key === item.key)) return;
                toggleAsramaRadioGroup(`asrama-nilai-${item.key}`, String(item.nilai));
                const catatan = document.querySelector(`[data-asrama-catatan="${item.key}"]`);
                if (catatan) catatan.value = item.catatan || '';
            });

            document.querySelectorAll('[data-asrama-layanan]').forEach(cb => {
                cb.checked = (data.layanan || []).includes(cb.value);
            });
            toggleAsramaRadioGroup('asrama-keberfungsian', data.keberfungsian || '');
            toggleAsramaRadioGroup('asrama-tindak-lanjut', data.tindakLanjut || '');
            document.getElementById('asrama-catatan').value = data.catatanTambahan || '';
            document.getElementById('asrama-klaster').value = normalizeAsramaKlaster(data.klaster);
            document.getElementById('modal-penilaian-asrama-title').innerText = 'Edit Instrumen Penilaian Asrama';
        }
    }

    syncAsramaIdentityFields();

    const isAdmin = currentUser && currentUser.role === 'admin';
    const pengasuhInput = document.getElementById('asrama-pengasuh');
    if (pengasuhInput) {
        pengasuhInput.readOnly = !isAdmin;
        pengasuhInput.classList.toggle('bg-slate-50', !isAdmin);
        pengasuhInput.classList.toggle('bg-white', isAdmin);
        pengasuhInput.title = isAdmin ? 'Admin dapat mengisi/mengoreksi nama pengasuh' : 'Terkunci sesuai akun pengasuh yang login';
    }

    const klasterInput = document.getElementById('asrama-klaster');
    if (klasterInput) {
        klasterInput.disabled = !isAdmin;
        klasterInput.classList.toggle('bg-slate-50', !isAdmin);
        klasterInput.classList.toggle('bg-white', isAdmin);
        klasterInput.title = isAdmin ? 'Admin dapat mengoreksi klaster PM' : 'Mengikuti kategori kasus PM yang dipilih';
    }

    if (editId && isAdmin) {
        const rec = dataPerkembangan.find(p => str(p.id) === str(editId));
        if (rec) {
            document.getElementById('asrama-pengasuh').value = rec.petugas || document.getElementById('asrama-pengasuh').value;
            if (rec.penilaianAsrama && rec.penilaianAsrama.klaster) {
                document.getElementById('asrama-klaster').value = normalizeAsramaKlaster(rec.penilaianAsrama.klaster);
            }
        }
    }

    updateAsramaScoreSummary();
    document.getElementById('modal-penilaian-asrama').classList.remove('hidden');
}

function closeAsramaAssessmentModal() {
    document.getElementById('modal-penilaian-asrama').classList.add('hidden');
}

async function saveAsramaAssessment(e) {
    e.preventDefault();

    if (!canUseAsramaAssessment()) {
        alert('Anda tidak memiliki hak akses untuk menyimpan penilaian asrama.');
        return;
    }

    const pmId = document.getElementById('asrama-pm').value;
    const pm = dataPM.find(item => str(item.id) === str(pmId));
    if (!pm) {
        alert('Pilih Penerima Manfaat terlebih dahulu.');
        return;
    }

    const indikator = getAsramaFormValues();
    const missing = indikator.find(item => item.nilai === 0);
    if (missing) {
        alert(`Nilai untuk indikator "${missing.nama}" belum diisi.`);
        return;
    }

    const total = indikator.reduce((sum, item) => sum + item.nilai, 0);
    const rataRata = total / indikator.length;
    const predikat = getAsramaPredikat(rataRata);
    const layanan = Array.from(document.querySelectorAll('[data-asrama-layanan]:checked')).map(el => el.value);
    const keberfungsianEl = document.querySelector('input[name="asrama-keberfungsian"]:checked');
    const tindakLanjutEl = document.querySelector('input[name="asrama-tindak-lanjut"]:checked');
    const rekomendasi = tindakLanjutEl
        ? (keberfungsianEl ? `${tindakLanjutEl.value} (Keberfungsian: ${keberfungsianEl.value})` : tindakLanjutEl.value)
        : (keberfungsianEl ? `Keberfungsian: ${keberfungsianEl.value}` : '');
    const catatanTambahan = document.getElementById('asrama-catatan').value.trim();
    const pengasuh = document.getElementById('asrama-pengasuh').value.trim() || (currentUser ? currentUser.username : '');
    const klaster = document.getElementById('asrama-klaster').value.trim();
    const tanggal = document.getElementById('asrama-tanggal').value;

    const id = document.getElementById('asrama-id').value || generateRecordId('PER');
    const existingIndex = dataPerkembangan.findIndex(p => p.id === id);
    const owner = existingIndex >= 0
        ? dataPerkembangan[existingIndex].createdByAccount
        : (currentUser ? currentUser.username : 'admin');

    const lowItems = indikator.filter(item => item.nilai <= 2);
    let deskripsi = `Penilaian asrama: total ${total}/40 (rata-rata ${rataRata.toFixed(2)}), predikat ${predikat.label}.`;
    if (lowItems.length > 0) {
        deskripsi += ` Perlu perhatian: ${lowItems.map(item => `${item.nama} (${item.nilai})`).join(', ')}.`;
    } else {
        deskripsi += ' Seluruh aspek perkembangan berada pada kategori baik.';
    }

    const penilaianAsrama = {
        instrumen: 'asrama-v1',
        tanggal,
        pengasuh,
        peksos: pm.peksos || '',
        asrama: pm.asrama || '',
        klaster,
        indikator,
        layanan,
        keberfungsian: keberfungsianEl ? keberfungsianEl.value : '',
        tindakLanjut: tindakLanjutEl ? tindakLanjutEl.value : '',
        catatanTambahan,
        total,
        rataRata: Number(rataRata.toFixed(2)),
        predikat: predikat.label
    };

    const newRecord = normalizePerkembanganRecord({
        id,
        pmId,
        tanggal,
        kategori: ASRAMA_KATEGORI,
        deskripsi,
        rekomendasi,
        petugas: pengasuh,
        foto: existingIndex >= 0 ? dataPerkembangan[existingIndex].foto : '',
        createdByAccount: owner,
        penilaianAsrama
    });

    if (existingIndex >= 0) {
        dataPerkembangan[existingIndex] = newRecord;
        addSystemLog('Ubah Penilaian Asrama', `Instrumen penilaian asrama diperbarui untuk ${pm.nama}.`);
    } else {
        dataPerkembangan.push(newRecord);
        addSystemLog('Tambah Penilaian Asrama', `Instrumen penilaian asrama ditambahkan untuk ${pm.nama}.`);
    }

    saveData();
    renderPerkembanganTable();
    closeAsramaAssessmentModal();
    showToast('Penilaian asrama berhasil disimpan!');

    const exportNow = await showAppConfirm('Penilaian asrama berhasil disimpan. Ekspor sekarang ke PDF?', {
        title: 'Ekspor PDF',
        okLabel: 'Ekspor Sekarang',
        danger: false
    });
    if (exportNow) printAsramaAssessment(id);
}

function renderAsramaTableSummary(rec) {
    const data = rec.penilaianAsrama || {};
    const total = Number(data.total) || 0;
    const rataRata = Number(data.rataRata) || 0;
    const predikat = data.predikat || getAsramaPredikat(rataRata).label;
    const lowItems = (data.indikator || []).filter(item => Number(item.nilai) <= 2);

    return `
        <p class="font-bold text-slate-800">Total ${total}/40 · Rata-rata ${rataRata.toFixed(2)} · <span class="text-indigo-700">${esc(predikat)}</span></p>
        ${lowItems.length > 0
            ? `<p class="text-[11px] text-rose-600 mt-0.5"><strong>Perlu perhatian:</strong> ${lowItems.map(item => esc(`${item.nama} (${item.nilai})`)).join(', ')}</p>`
            : `<p class="text-[11px] text-emerald-600 mt-0.5">Seluruh aspek minimal bernilai baik.</p>`}
        ${data.keberfungsian ? `<p class="text-[11px] text-slate-500 mt-0.5">Keberfungsian: ${esc(data.keberfungsian)}</p>` : ''}
        ${data.catatanTambahan ? `<p class="whitespace-pre-line mt-1">${esc(data.catatanTambahan)}</p>` : ''}
    `;
}

/* --- EKSPOR PDF INSTRUMEN PENILAIAN ASRAMA (mengikuti template instrumen) --- */
function renderAsramaSignName(name) {
    const clean = str(name).trim();
    return clean && clean !== '-' ? `( ${esc(clean)} )` : '( _____________________ )';
}

function renderAsramaAssessmentPrint(rec) {
    const pm = dataPM.find(item => str(item.id) === str(rec.pmId)) || {};
    const data = rec.penilaianAsrama || {};
    const signatures = getAsramaReportSignatures(pm, data);

    const items = ASRAMA_INDIKATOR.map(ind => {
        const stored = (data.indikator || []).find(item => item.key === ind.key);
        return {
            nama: (stored && str(stored.nama)) || ind.nama,
            deskripsi: ind.deskripsi,
            nilai: stored ? Number(stored.nilai) || 0 : 0,
            catatan: stored ? str(stored.catatan) : ''
        };
    });

    const keberfungsian = data.keberfungsian || '';
    const tindakLanjut = data.tindakLanjut || '';
    const pengasuh = data.pengasuh || signatures.pengasuh;

    const field = (label, value) => `
        <p class="asrama-print-field">
            <span class="asrama-print-key">${esc(label)}</span>
            <span class="asrama-print-colon">:</span>
            <span class="asrama-print-val">${esc(value) || '-'}</span>
        </p>`;

    const checkRow = (label, checked) => `
        <p class="asrama-print-check">
            <span class="asrama-print-box${checked ? ' is-on' : ''}">${checked ? '&#10003;' : ''}</span>
            <span>${esc(label)}</span>
        </p>`;

    return `
        <div class="asrama-print-title">INSTRUMEN EVALUASI &amp; PERKEMBANGAN PENERIMA MANFAAT (PM) di ASRAMA</div>

        <div class="asrama-print-section">
            <p class="asrama-print-section-title">I. Identitas Penerima Manfaat &amp; Petugas</p>
            <div class="asrama-print-ident">
                ${field('Nama PM', pm.nama)}
                ${field('Pengasuh Asrama', pengasuh)}
                ${field('Asrama', data.asrama || pm.asrama)}
                ${field('Pekerja Sosial', data.peksos || pm.peksos)}
                ${field('Tanggal Masuk', pm.masuk ? formatDateOnly(pm.masuk) : '-')}
                ${field('Klaster PM', normalizeAsramaKlaster(data.klaster) || getAsramaKlasterFromKasus(pm.kasus))}
            </div>
        </div>

        <div class="asrama-print-section">
            <p class="asrama-print-section-title">II. Evaluasi Perkembangan PM Asrama</p>
            <table class="asrama-print-table">
                <thead>
                    <tr>
                        <th class="asrama-print-no">No</th>
                        <th>Indikator / Aspek Perkembangan</th>
                        <th class="asrama-print-nilai">Nilai (1 - 4)</th>
                        <th class="asrama-print-catatan">Catatan Perilaku &amp; Intervensi Pengasuh</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((item, index) => `
                        <tr>
                            <td class="asrama-print-no">${index + 1}</td>
                            <td>
                                <p class="asrama-print-ind-name">${esc(item.nama)}</p>
                                <p class="asrama-print-ind-desc">${esc(item.deskripsi)}</p>
                            </td>
                            <td class="asrama-print-nilai">
                                ${ASRAMA_SKALA.map(skala => `<span class="asrama-print-nbox${item.nilai === skala.nilai ? ' is-on' : ''}">${skala.nilai}</span>`).join('')}
                            </td>
                            <td class="asrama-print-catatan">${esc(item.catatan) || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="asrama-print-legend">
                <p class="asrama-print-legend-title">Nilai</p>
                ${ASRAMA_SKALA.map(skala => `<p><strong>${skala.nilai} (${esc(skala.label)}):</strong> ${esc(skala.deskripsi)}</p>`).join('')}
            </div>
        </div>

        <div class="asrama-print-section">
            <p class="asrama-print-section-title">III. Layanan yang Sudah Diberikan:</p>
            ${ASRAMA_LAYANAN.map(item => checkRow(item, (data.layanan || []).includes(item))).join('')}
        </div>

        <div class="asrama-print-section">
            <p class="asrama-print-section-title">IV. Kesimpulan &amp; Rekomendasi Pekerja Sosial</p>
            <p class="asrama-print-sub">Tingkat Keberfungsian Sosial saat ini:</p>
            ${ASRAMA_KEBERFUNGSIAN.map(item => checkRow(item, item === keberfungsian)).join('')}
            <p class="asrama-print-sub">Rekomendasi tindak lanjut (TL):</p>
            ${ASRAMA_TINDAK_LANJUT.map(item => checkRow(item, item === tindakLanjut)).join('')}
            <div class="asrama-print-note">
                <span class="asrama-print-note-label">Catatan tambahan / kesimpulan pengasuh:</span>
                <p>${esc(data.catatanTambahan) || '-'}</p>
            </div>
        </div>

        <div class="asrama-print-signs">
            <div class="asrama-print-sign">
                <span class="asrama-print-sign-role">Pengasuh Asrama</span>
                <span class="asrama-print-sign-name">${renderAsramaSignName(pengasuh)}</span>
            </div>
            <div class="asrama-print-sign">
                <span class="asrama-print-sign-role">Pekerja Sosial</span>
                <span class="asrama-print-sign-name">${renderAsramaSignName(signatures.peksos)}</span>
            </div>
            <div class="asrama-print-sign">
                <span class="asrama-print-sign-role">Penanggungjawab Pengasuhan</span>
                <span class="asrama-print-sign-name">${renderAsramaSignName(signatures.penanggung)}</span>
            </div>
            <div class="asrama-print-sign">
                <span class="asrama-print-sign-role">Kapokja Residensial</span>
                <span class="asrama-print-sign-name">${renderAsramaSignName(signatures.kapokja)}</span>
            </div>
        </div>
    `;
}

function printAsramaAssessment(recordId) {
    if (!canUseAsramaAssessment()) {
        alert('Ekspor PDF instrumen asrama hanya tersedia untuk Pengasuh Asrama Residensial.');
        return;
    }

    const rec = dataPerkembangan.find(p => str(p.id) === str(recordId));
    if (!rec || !rec.penilaianAsrama) {
        alert('Data penilaian asrama tidak ditemukan.');
        return;
    }

    if (currentUser && currentUser.role !== 'admin' && !canUserModify(rec.createdByAccount)) {
        alert('Anda hanya dapat mengekspor penilaian asrama milik akun Anda.');
        return;
    }

    const area = document.getElementById('asrama-print-area');
    if (!area) return;

    const pm = dataPM.find(item => str(item.id) === str(rec.pmId));
    const previousTitle = document.title;
    document.title = `Penilaian Asrama - ${pm ? pm.nama : 'PM'}`;
    area.innerHTML = `<div class="asrama-print-sheet">${renderAsramaAssessmentPrint(rec)}</div>`;

    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        document.body.classList.remove('printing-asrama');
        document.title = previousTitle;
        area.innerHTML = '';
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    document.body.classList.add('printing-asrama');
    window.print();
    setTimeout(cleanup, 60000);
}

function updatePerkembanganKategoriOptions() {
    const selectPetugas = document.getElementById('perkembangan-petugas');
    const selectKategori = document.getElementById('perkembangan-kategori');
    const selectPM = document.getElementById('perkembangan-pm');
    if (!selectPetugas || !selectKategori) return;

    const selectedNamaPetugas = selectPetugas.value;
    const currentKategoriVal = selectKategori.value;

    const petugasObj = dataPegawai.find(p => p.nama === selectedNamaPetugas || `${p.nama} (${p.jabatan})` === selectedNamaPetugas);
    
    let optionsHtml = '';
    let filteredPMList = dataPM;

    if (petugasObj) {
        const jabatanKey = normalizeJabatan(petugasObj.jabatan);
        optionsHtml = getKategoriPenilaianByJabatan(petugasObj.jabatan)
            .filter(kategori => kategori !== ASRAMA_KATEGORI)
            .map(kategori => `<option value="${esc(kategori)}">${esc(kategori)}</option>`)
            .join('');

        if (jabatanKey.includes('instruktur') && petugasObj.vokasional) {
            filteredPMList = dataPM.filter(pm => pm.vokasional === petugasObj.vokasional);
        } else if (jabatanKey.includes('pengasuh') && petugasObj.asrama) {
            filteredPMList = dataPM.filter(pm => isSameAsrama(pm.asrama, petugasObj.asrama));
        }
    } else {
        optionsHtml = KATEGORI_PENILAIAN
            .filter(kategori => kategori !== ASRAMA_KATEGORI)
            .map(kategori => `<option value="${esc(kategori)}">${esc(kategori)}</option>`)
            .join('');
    }

    selectKategori.innerHTML = optionsHtml;

    // Nilai lama hanya dipertahankan untuk admin; non-admin selalu mulai dari kategori jabatannya.
    if (currentKategoriVal && currentKategoriVal !== ASRAMA_KATEGORI && currentUser && currentUser.role === 'admin') {
        const exists = Array.from(selectKategori.options).some(opt => opt.value === currentKategoriVal);
        if (!exists) {
            const extra = document.createElement('option');
            extra.value = currentKategoriVal;
            extra.textContent = currentKategoriVal;
            selectKategori.appendChild(extra);
        }
        selectKategori.value = currentKategoriVal;
    }

    if (selectPM) {
        const currentPMVal = selectPM.value;
        selectPM.innerHTML = filteredPMList.map(p => `<option value="${esc(p.id)}">${esc(p.nama)} - (${esc(p.kasus)})</option>`).join('');
        if (currentPMVal && Array.from(selectPM.options).some(opt => opt.value === currentPMVal)) {
            selectPM.value = currentPMVal;
        }
    }
}

/* Non-admin hanya melihat kategori yang boleh dinilai sesuai jabatannya. */
function applyKategoriFilterScope() {
    const select = document.getElementById('filter-kategori-perkembangan');
    if (!select || !currentUser || currentUser.role === 'admin') return;

    const myPegawai = getMyPegawai();
    let allowed = myPegawai ? getKategoriPenilaianByJabatan(myPegawai.jabatan) : [];
    if (!canUseAsramaAssessment()) {
        allowed = allowed.filter(kategori => kategori !== ASRAMA_KATEGORI);
    }
    if (allowed.length === 0) return;

    const ownKategori = dataPerkembangan
        .filter(rec => str(rec.createdByAccount) === currentUser.username)
        .map(rec => rec.kategori);
    setSelectOptions(select, uniqueValues(allowed, ownKategori), '-- Semua Kategori --');
}

/* Sinkronkan semua pilihan dropdown dengan data terbaru tanpa menghapus nilai unik dari cloud. */
function refreshDynamicOptions() {
    const kasusValues = uniqueValues(KASUS_DEFAULTS, dataPM.map(pm => pm.kasus));
    const vokasionalValues = uniqueValues(VOKASIONAL_DEFAULTS, dataPM.map(pm => pm.vokasional));
    const asramaValues = uniqueValues(
        ASRAMA_DEFAULTS,
        dataPM.map(pm => pm.asrama).filter(value => value && value !== 'Rumah Antara' && value !== 'Non-Residensial')
    );

    setSelectOptions(document.getElementById('pm-kasus'), kasusValues);
    setSelectOptions(document.getElementById('pm-vokasional'), vokasionalValues);
    setSelectOptions(document.getElementById('pegawai-vokasional'), vokasionalValues);
    setSelectOptions(document.getElementById('init-pegawai-vokasional'), vokasionalValues);
    setSelectOptions(document.getElementById('select-laporan-vokasional'), vokasionalValues);
    setSelectOptions(document.getElementById('select-laporan-kasus'), kasusValues);

    setSelectOptions(document.getElementById('pm-nama-asrama-select'), asramaValues);
    setSelectOptions(document.getElementById('pegawai-asrama'), asramaValues);
    setSelectOptions(document.getElementById('init-pegawai-asrama'), asramaValues);
    setSelectOptions(
        document.getElementById('select-laporan-asrama'),
        uniqueValues(['Rumah Antara'], ASRAMA_DEFAULTS, dataPM.map(pm => pm.asrama))
    );

    setSelectOptions(
        document.getElementById('filter-jabatan-pegawai'),
        uniqueValues(JABATAN_DEFAULTS, dataPegawai.map(peg => peg.jabatan)),
        '-- Semua Jabatan --'
    );
    setSelectOptions(
        document.getElementById('filter-pokja-pegawai'),
        uniqueValues(POKJA_DEFAULTS, dataPegawai.map(peg => peg.pokja)),
        '-- Semua Pokja --'
    );
    setSelectOptions(
        document.getElementById('filter-kategori-perkembangan'),
        uniqueValues(KATEGORI_DEFAULTS, dataPerkembangan.map(rec => rec.kategori)),
        '-- Semua Kategori --'
    );
    applyKategoriFilterScope();

    const peksosValues = uniqueValues(
        dataPegawai.filter(peg => peg.jabatan === 'Pekerja Sosial' || peg.jabatan === 'Ketua Pokja').map(peg => peg.nama),
        dataPM.map(pm => pm.peksos)
    );
    setSelectOptions(document.getElementById('pm-peksos'), peksosValues);
    setSelectOptions(document.getElementById('select-laporan-peksos'), peksosValues);
}

function updateDropdownOptions() {
    const peksosSelect = document.getElementById('pm-peksos');
    if (!peksosSelect) return;

    refreshDynamicOptions();

    const filterPerkembangan = document.getElementById('filter-perkembangan-pm');
    const perkPMSelect = document.getElementById('perkembangan-pm');
    const perkPetugasSelect = document.getElementById('perkembangan-petugas');

    if (perkPetugasSelect && currentUser) {
        if (currentUser.role === 'admin') {
            const previousPetugas = perkPetugasSelect.value;
            const names = uniqueValues(dataPegawai.map(peg => peg.nama));
            perkPetugasSelect.innerHTML = names.map(nama => {
                const peg = dataPegawai.find(item => item.nama === nama);
                const suffix = peg && peg.jabatan ? ` (${esc(peg.jabatan)})` : '';
                return `<option value="${esc(nama)}">${esc(nama)}${suffix}</option>`;
            }).join('');
            perkPetugasSelect.removeAttribute('disabled');

            // Saat mengedit catatan lama, pertahankan nama petugas yang mungkin sudah tidak ada di data pegawai.
            if (previousPetugas) {
                const exists = Array.from(perkPetugasSelect.options).some(opt => opt.value === previousPetugas);
                if (!exists) {
                    const extra = document.createElement('option');
                    extra.value = previousPetugas;
                    extra.textContent = previousPetugas;
                    perkPetugasSelect.appendChild(extra);
                }
                perkPetugasSelect.value = previousPetugas;
            }
        } else {
            // Petugas non-admin selalu dikunci ke profilnya sendiri agar kategori sesuai jabatannya.
            const myPegawai = getMyPegawai();
            if (myPegawai) {
                perkPetugasSelect.innerHTML = `<option value="${esc(myPegawai.nama)}">${esc(myPegawai.nama)} (${esc(myPegawai.jabatan)})</option>`;
                perkPetugasSelect.value = myPegawai.nama;
            } else {
                perkPetugasSelect.innerHTML = `<option value="${esc(currentUser.username)}">${esc(currentUser.username)}</option>`;
                perkPetugasSelect.value = currentUser.username;
            }
            perkPetugasSelect.setAttribute('disabled', 'true');
        }
    }

    updatePerkembanganKategoriOptions();

    const buildPmOptions = placeholder => {
        const head = placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '';
        const items = dataPM.map(pm => `<option value="${esc(pm.id)}">${esc(pm.nama)} - (${esc(pm.kasus)})</option>`).join('');
        const empty = (dataPM.length === 0 && placeholder === undefined) ? `<option value="">Belum ada data PM</option>` : '';
        return head + items + empty;
    };

    if (filterPerkembangan) {
        const previous = filterPerkembangan.value;
        filterPerkembangan.innerHTML = buildPmOptions('-- Semua PM --');
        if (previous && Array.from(filterPerkembangan.options).some(opt => opt.value === previous)) {
            filterPerkembangan.value = previous;
        }
    }

    if (perkPMSelect) {
        const previous = perkPMSelect.value;
        perkPMSelect.innerHTML = buildPmOptions();
        if (previous && Array.from(perkPMSelect.options).some(opt => opt.value === previous)) {
            perkPMSelect.value = previous;
        }
    }
}

function togglePMResidensialOption(isResidensial) {
    const wrapperResidensial = document.getElementById('pm-wrapper-residensial');
    if (isResidensial) {
        wrapperResidensial.classList.remove('hidden');
        togglePMAsramaCustomSelect();
    } else {
        wrapperResidensial.classList.add('hidden');
        document.getElementById('pm-wrapper-nama-asrama').classList.add('hidden');
    }
}

function togglePMAsramaCustomSelect() {
    const asramaVal = document.getElementById('pm-asrama').value;
    const wrapperNamaAsrama = document.getElementById('pm-wrapper-nama-asrama');
    if (asramaVal === 'Asrama Residensial') {
        wrapperNamaAsrama.classList.remove('hidden');
    } else {
        wrapperNamaAsrama.classList.add('hidden');
    }
}

function savePM(e) {
    e.preventDefault();
    const id = document.getElementById('pm-id').value || generateRecordId('PM');
    const fotoInput = document.getElementById('pm-foto');
    const terminasiVal = document.getElementById('pm-terminasi').value;

    if (!terminasiVal) {
        alert('Tanggal Rencana Terminasi wajib diisi!');
        return;
    }

    const handleSave = (fotoBase64) => {
        const existingIndex = dataPM.findIndex(p => p.id === id);
        const owner = existingIndex >= 0 ? dataPM[existingIndex].createdByAccount : (currentUser ? currentUser.username : 'admin');

        const isResidensial = document.querySelector('input[name="pm-is-residensial"]:checked').value === 'ya';
        let lokasiAsrama = '';
        if (isResidensial) {
            const tipeAsrama = document.getElementById('pm-asrama').value;
            lokasiAsrama = tipeAsrama === 'Rumah Antara'
                ? 'Rumah Antara'
                : document.getElementById('pm-nama-asrama-select').value;
        }

        const newPM = normalizePMRecord({
            id: id,
            nama: document.getElementById('pm-nama').value,
            ibu: document.getElementById('pm-ibu').value,
            jk: document.getElementById('pm-jk').value,
            kasus: document.getElementById('pm-kasus').value,
            vokasional: document.getElementById('pm-vokasional').value,
            asrama: lokasiAsrama,
            residensial: lokasiAsrama,
            status: document.getElementById('pm-status').value,
            peksos: document.getElementById('pm-peksos').value,
            masuk: document.getElementById('pm-masuk').value,
            terminasi: terminasiVal,
            foto: fotoBase64 || (existingIndex >= 0 ? dataPM[existingIndex].foto : ''),
            createdByAccount: owner
        });

        if (existingIndex >= 0) {
            dataPM[existingIndex] = newPM;
            addSystemLog('Ubah PM', `Data Penerima Manfaat ${newPM.nama} diperbarui.`);
        } else {
            dataPM.push(newPM);
            addSystemLog('Tambah PM', `Penerima Manfaat baru ${newPM.nama} ditambahkan.`);
        }

        saveData();
        renderPMTable();
        updateDropdownOptions();
        closePMModal();
        showToast('Data Penerima Manfaat berhasil disimpan!');
    };

    if (fotoInput.files && fotoInput.files[0]) {
        compressImage(fotoInput.files[0], handleSave);
    } else {
        handleSave(null);
    }
}

function toggleModalConditionalFields() {
    const jabatan = document.getElementById('pegawai-jabatan').value;
    const wrapperVokasional = document.getElementById('modal-wrapper-vokasional');
    if (jabatan === 'Instruktur') {
        wrapperVokasional.classList.remove('hidden');
    } else {
        wrapperVokasional.classList.add('hidden');
    }
}

function toggleModalAsramaOption(isPengasuh) {
    const wrapperAsrama = document.getElementById('modal-wrapper-asrama');
    if (isPengasuh) {
        wrapperAsrama.classList.remove('hidden');
    } else {
        wrapperAsrama.classList.add('hidden');
    }
}

function savePegawai(e) {
    e.preventDefault();
    const id = document.getElementById('pegawai-id').value || generateRecordId('PEG_');
    const fotoInput = document.getElementById('pegawai-foto');
    const existingIndex = dataPegawai.findIndex(p => p.id === id);

    if (existingIndex >= 0 && !canUserModify(dataPegawai[existingIndex].createdByAccount, dataPegawai[existingIndex].nip, id)) {
        alert('Akses ditolak! Anda hanya dapat mengubah data pegawai milik akun Anda sendiri.');
        return;
    }

    if (!fotoInput.files || !fotoInput.files[0]) {
        if (existingIndex < 0 || !isUsablePhoto(dataPegawai[existingIndex].foto)) {
            alert('Foto pegawai wajib diunggah!');
            return;
        }
    }

    const handleSave = (fotoBase64) => {
        const oldOwner = existingIndex >= 0 ? dataPegawai[existingIndex].createdByAccount : '';
        const owner = oldOwner || (currentUser ? currentUser.username : 'admin');

        const jabatanVal = document.getElementById('pegawai-jabatan').value;
        const isPengasuhChecked = document.querySelector('input[name="modal-is-pengasuh"]:checked').value === 'ya';

        const newPegawai = normalizePegawaiRecord({
            id: id,
            nama: document.getElementById('pegawai-nama').value,
            nip: document.getElementById('pegawai-nip').value,
            jabatan: jabatanVal,
            pokja: document.getElementById('pegawai-pokja').value,
            vokasional: jabatanVal === 'Instruktur' ? document.getElementById('pegawai-vokasional').value : '',
            asrama: isPengasuhChecked ? document.getElementById('pegawai-asrama').value : '',
            pengasuhAsrama: isPengasuhChecked,
            foto: fotoBase64 || (existingIndex >= 0 ? dataPegawai[existingIndex].foto : ''),
            createdByAccount: owner
        });

        if (existingIndex >= 0) {
            dataPegawai[existingIndex] = newPegawai;
            addSystemLog('Ubah Pegawai', `Data pegawai ${newPegawai.nama} diperbarui.`);
        } else {
            dataPegawai.push(newPegawai);
            addSystemLog('Tambah Pegawai', `Pegawai baru ${newPegawai.nama} ditambahkan.`);
        }

        if (currentUser && currentUser.role !== 'admin') {
            currentUser.pegawaiId = id;
            usersDB[currentUser.username].pegawaiId = id;
            localStorage.setItem('sh_logged_user', JSON.stringify(currentUser));
        }

        saveData();
        renderPegawaiTable();
        updateDropdownOptions();
        updateJurnalSubTitle();
        closePegawaiModal();
        showToast('Data pegawai berhasil disimpan!');
    };

    if (fotoInput.files && fotoInput.files[0]) {
        compressImage(fotoInput.files[0], handleSave);
    } else {
        handleSave(null);
    }
}

function savePerkembangan(e) {
    e.preventDefault();
    const id = document.getElementById('perkembangan-id').value || generateRecordId('PER');
    const fotoInput = document.getElementById('perkembangan-foto');
    const selectPetugas = document.getElementById('perkembangan-petugas');
    const selectPM = document.getElementById('perkembangan-pm');
    const selectedNamaPetugas = selectPetugas ? selectPetugas.value : '';

    if (!selectPM || !selectPM.value) {
        alert('Pilih Penerima Manfaat terlebih dahulu. Tambahkan data PM jika belum ada.');
        return;
    }

    const petugasObj = dataPegawai.find(p => p.nama === selectedNamaPetugas || `${p.nama} (${p.jabatan})` === selectedNamaPetugas);
    const isPetugasKeamanan = petugasObj && petugasObj.jabatan === 'Petugas Keamanan';

    const existingIndex = dataPerkembangan.findIndex(p => p.id === id);
    const hasExistingFoto = existingIndex >= 0 && dataPerkembangan[existingIndex].foto;
    const selectedKategori = document.getElementById('perkembangan-kategori').value;

    if (selectedKategori === ASRAMA_KATEGORI) {
        const isLegacyAsramaEdit = existingIndex >= 0
            && str(dataPerkembangan[existingIndex].kategori) === ASRAMA_KATEGORI
            && !dataPerkembangan[existingIndex].penilaianAsrama;
        if (!isLegacyAsramaEdit) {
            alert('Kategori "Penilaian Asrama Bulanan" diisi melalui tombol "Form Penilaian Asrama" agar instrumen 10 aspek tersimpan lengkap.');
            return;
        }
    }

    if (petugasObj) {
        const allowedKategori = getKategoriPenilaianByJabatan(petugasObj.jabatan);
        const isEditingLegacyKategori = existingIndex >= 0 && str(dataPerkembangan[existingIndex].kategori) === selectedKategori;
        if (!allowedKategori.includes(selectedKategori) && !isEditingLegacyKategori) {
            alert(`Kategori "${selectedKategori}" tidak sesuai dengan jabatan ${petugasObj.jabatan}.`);
            return;
        }
    }

    if (isPetugasKeamanan && (!fotoInput.files || !fotoInput.files[0]) && !hasExistingFoto) {
        alert('Validasi Gagal: Petugas Keamanan wajib mengunggah foto dokumentasi bukti rekam perkembangan / kejadian!');
        return;
    }

    const handleSave = (fotoBase64) => {
        const owner = existingIndex >= 0 ? dataPerkembangan[existingIndex].createdByAccount : (currentUser ? currentUser.username : 'admin');

        const newRecord = normalizePerkembanganRecord({
            id: id,
            pmId: selectPM.value,
            tanggal: document.getElementById('perkembangan-tanggal').value,
            kategori: selectedKategori,
            deskripsi: document.getElementById('perkembangan-deskripsi').value,
            rekomendasi: document.getElementById('perkembangan-rekomendasi').value,
            petugas: selectedNamaPetugas,
            foto: fotoBase64 || (existingIndex >= 0 ? dataPerkembangan[existingIndex].foto : ''),
            createdByAccount: owner
        });

        if (existingIndex >= 0) {
            dataPerkembangan[existingIndex] = newRecord;
            addSystemLog('Ubah Perkembangan', `Catatan perkembangan diperbarui.`);
        } else {
            dataPerkembangan.push(newRecord);
            addSystemLog('Tambah Perkembangan', `Catatan perkembangan baru ditambahkan.`);
        }

        saveData();
        renderPerkembanganTable();
        closePerkembanganModal();
        showToast('Catatan rekam perkembangan berhasil disimpan!');
    };

    if (fotoInput.files && fotoInput.files[0]) {
        compressImage(fotoInput.files[0], handleSave);
    } else {
        handleSave(null);
    }
}

async function deletePM(id) {
    const item = dataPM.find(p => p.id === id);
    if (!item || !canUserModify(item.createdByAccount)) {
        alert('Anda tidak memiliki hak akses untuk menghapus data ini.');
        return;
    }
    const confirmed = await showAppConfirm('Hapus data PM ini? Semua rekam perkembangan terkait juga akan terhapus.', {
        title: 'Hapus Data PM',
        okLabel: 'Ya, Hapus'
    });
    if (confirmed) {
        dataPM = dataPM.filter(p => p.id !== id);
        dataPerkembangan = dataPerkembangan.filter(p => p.pmId !== id);
        saveData();
        renderPMTable();
        renderPerkembanganTable();
        updateDropdownOptions();
        addSystemLog('Hapus PM', `Penerima Manfaat ${item.nama} dihapus.`);
        showToast('Data Penerima Manfaat berhasil dihapus.');
    }
}

async function deletePegawai(id) {
    const item = dataPegawai.find(p => p.id === id);
    if (!item) {
        alert('Data pegawai tidak ditemukan.');
        return;
    }

    if (!canUserModify(item.createdByAccount)) {
        alert('Akses ditolak! Anda hanya dapat menghapus data pegawai yang dibuat oleh akun Anda sendiri.');
        return;
    }

    const confirmed = await showAppConfirm('Apakah Anda yakin ingin menghapus data pegawai ini?', {
        title: 'Hapus Data Pegawai',
        okLabel: 'Ya, Hapus'
    });
    if (confirmed) {
        dataPegawai = dataPegawai.filter(p => p.id !== id);

        Object.keys(usersDB).forEach(username => {
            if (usersDB[username].pegawaiId === id) {
                usersDB[username].pegawaiId = null;
            }
        });

        if (currentUser && str(currentUser.pegawaiId) === str(id)) {
            currentUser.pegawaiId = null;
            localStorage.setItem('sh_logged_user', JSON.stringify(currentUser));
        }

        saveData();
        renderPegawaiTable();
        updateDropdownOptions();
        updateJurnalSubTitle();
        addSystemLog('Hapus Pegawai', `Pegawai ${item.nama} dihapus.`);
        showToast('Data pegawai berhasil dihapus.');
    }
}

async function deletePerkembangan(id) {
    const item = dataPerkembangan.find(p => p.id === id);
    if (!item || !canUserModify(item.createdByAccount)) {
        alert('Anda tidak memiliki hak akses untuk menghapus data ini.');
        return;
    }
    const confirmed = await showAppConfirm('Hapus catatan perkembangan ini?', {
        title: 'Hapus Catatan Perkembangan',
        okLabel: 'Ya, Hapus'
    });
    if (confirmed) {
        dataPerkembangan = dataPerkembangan.filter(p => p.id !== id);
        saveData();
        renderPerkembanganTable();
        addSystemLog('Hapus Perkembangan', `Catatan perkembangan dihapus.`);
        showToast('Catatan perkembangan berhasil dihapus.');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('border-indigo-600', 'text-indigo-600', 'border-amber-600', 'text-amber-600', 'font-bold');
        el.classList.add('border-transparent', 'text-slate-500', 'font-semibold');
    });

    const activeSection = document.getElementById(`tab-${tabName}`);
    activeSection.classList.remove('hidden');
    activeSection.scrollTop = 0;
    const activeBtn = document.getElementById(`tab-${tabName}-btn`);
    activeBtn.classList.remove('border-transparent', 'text-slate-500', 'font-semibold');
    activeBtn.classList.add('font-bold');

    if (tabName === 'perkembangan') {
        const newBadge = document.getElementById('perkembangan-new-badge');
        if (newBadge) newBadge.classList.add('hidden');
    }

    if (tabName === 'admin') {
        activeBtn.classList.add('border-amber-600', 'text-amber-600');
        renderPwdRequestsTable();
    } else {
        activeBtn.classList.add('border-indigo-600', 'text-indigo-600');
    }

    if(tabName === 'laporan') {
        updateLaporanTypeOptions();
        populateLaporanSelect();
        toggleLaporanType();
    }
    if(tabName === 'pm') {
        renderCharts();
    }
}

function updateLaporanTypeOptions() {
    const selectTipe = document.getElementById('select-tipe-laporan');
    if (!selectTipe) return;

    if (currentUser && currentUser.role === 'admin') {
        selectTipe.innerHTML = `
            <option value="individu">Form Terkini per PM (Nama PM)</option>
            <option value="peksos">Filter Berdasarkan Nama Peksos</option>
            <option value="kasus">Filter Berdasarkan Kategori Kasus</option>
            <option value="vokasional">Filter Berdasarkan Vokasional</option>
            <option value="asrama">Filter Berdasarkan Nama Asrama</option>
            <option value="rekapitulasi">Rekapitulasi Seluruh Database PM</option>
        `;
        return;
    }

    const myPegawai = getMyPegawai();

    let optionsHtml = `<option value="individu">Form Terkini per PM (Hanya Data Saya)</option>`;

    if (myPegawai) {
        const jabatanKey = normalizeJabatan(myPegawai.jabatan);
        const allowedKategori = getKategoriPenilaianByJabatan(myPegawai.jabatan);

        if (allowedKategori.includes('Vokasional')) {
            optionsHtml += `<option value="vokasional">Laporan Penilaian Vokasional (${myPegawai.vokasional || 'Bidang'})</option>`;
        }
        if (canUseAsramaAssessment()) {
            optionsHtml += `<option value="asrama">Laporan Penilaian Asrama (${myPegawai.asrama || 'Asrama'})</option>`;
        }
        if (jabatanKey.includes('pekerja sosial') || jabatanKey.includes('ketua pokja')) {
            optionsHtml += `<option value="peksos">Laporan Berdasarkan Peksos Pendamping (${myPegawai.nama})</option>`;
        }
    } else {
        optionsHtml += `<option value="rekapitulasi">Rekapitulasi Data Milik Saya</option>`;
    }

    selectTipe.innerHTML = optionsHtml;
}

function openPMModal(editId = null) {
    document.getElementById('form-pm').reset();
    document.getElementById('pm-id').value = '';
    document.getElementById('modal-pm-title').innerText = 'Tambah Data Penerima Manfaat';
    document.querySelector('input[name="pm-is-residensial"][value="tidak"]').checked = true;
    togglePMResidensialOption(false);
    renderPhotoPreview('pm-foto-preview', '', '');
    updateDropdownOptions();

    if (editId) {
        const pm = dataPM.find(p => str(p.id) === str(editId));
        if (pm) {
            document.getElementById('pm-id').value = pm.id;
            document.getElementById('pm-nama').value = pm.nama;
            document.getElementById('pm-ibu').value = pm.ibu;

            const jkSelect = document.getElementById('pm-jk');
            if (pm.jk && !Array.from(jkSelect.options).some(opt => opt.value === pm.jk)) {
                jkSelect.insertAdjacentHTML('beforeend', `<option value="${esc(pm.jk)}">${esc(pm.jk)}</option>`);
            }
            jkSelect.value = pm.jk;

            const kasusSelect = document.getElementById('pm-kasus');
            if (pm.kasus && !Array.from(kasusSelect.options).some(opt => opt.value === pm.kasus)) {
                kasusSelect.insertAdjacentHTML('beforeend', `<option value="${esc(pm.kasus)}">${esc(pm.kasus)}</option>`);
            }
            kasusSelect.value = pm.kasus;

            const vokSelect = document.getElementById('pm-vokasional');
            if (pm.vokasional && !Array.from(vokSelect.options).some(opt => opt.value === pm.vokasional)) {
                vokSelect.insertAdjacentHTML('beforeend', `<option value="${esc(pm.vokasional)}">${esc(pm.vokasional)}</option>`);
            }
            vokSelect.value = pm.vokasional || vokSelect.options[0]?.value || '';

            if (pm.asrama) {
                document.querySelector('input[name="pm-is-residensial"][value="ya"]').checked = true;
                togglePMResidensialOption(true);
                if (pm.asrama === 'Rumah Antara') {
                    document.getElementById('pm-asrama').value = 'Rumah Antara';
                    togglePMAsramaCustomSelect();
                } else {
                    document.getElementById('pm-asrama').value = 'Asrama Residensial';
                    togglePMAsramaCustomSelect();
                    const asramaSelect = document.getElementById('pm-nama-asrama-select');
                    if (!Array.from(asramaSelect.options).some(opt => opt.value === pm.asrama)) {
                        asramaSelect.insertAdjacentHTML('beforeend', `<option value="${esc(pm.asrama)}">${esc(pm.asrama)}</option>`);
                    }
                    asramaSelect.value = pm.asrama;
                }
            }

            document.getElementById('pm-status').value = pm.status;
            const peksosSelect = document.getElementById('pm-peksos');
            if (pm.peksos && !Array.from(peksosSelect.options).some(opt => opt.value === pm.peksos)) {
                peksosSelect.insertAdjacentHTML('beforeend', `<option value="${esc(pm.peksos)}">${esc(pm.peksos)}</option>`);
            }
            peksosSelect.value = pm.peksos;

            document.getElementById('pm-masuk').value = toDateInputValue(pm.masuk);
            document.getElementById('pm-terminasi').value = toDateInputValue(pm.terminasi);
            renderPhotoPreview('pm-foto-preview', pm.foto, pm.nama);
            document.getElementById('modal-pm-title').innerText = 'Edit Data Penerima Manfaat';
        }
    }
    document.getElementById('modal-pm').classList.remove('hidden');
}

function closePMModal() { document.getElementById('modal-pm').classList.add('hidden'); }
function editPM(id) { openPMModal(id); }

function openPegawaiModal(editId = null) {
    document.getElementById('form-pegawai').reset();
    document.getElementById('pegawai-id').value = '';
    document.getElementById('modal-pegawai-title').innerText = 'Tambah Data Pegawai';
    document.getElementById('modal-wrapper-vokasional').classList.add('hidden');
    document.getElementById('modal-wrapper-asrama').classList.add('hidden');
    document.querySelector('input[name="modal-is-pengasuh"][value="tidak"]').checked = true;
    renderPhotoPreview('pegawai-foto-preview', '', '');
    updateDropdownOptions();

    const ensureOption = (selectId, value) => {
        if (!value) return;
        const select = document.getElementById(selectId);
        if (!select) return;
        if (!Array.from(select.options).some(opt => opt.value === value)) {
            select.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`);
        }
        select.value = value;
    };

    if (editId) {
        const peg = dataPegawai.find(p => str(p.id) === str(editId));
        if (peg) {
            document.getElementById('pegawai-id').value = peg.id;
            document.getElementById('pegawai-nama').value = peg.nama;
            document.getElementById('pegawai-nip').value = peg.nip;

            ensureOption('pegawai-jabatan', peg.jabatan);
            ensureOption('pegawai-pokja', peg.pokja);

            toggleModalConditionalFields();
            if (peg.vokasional) {
                ensureOption('pegawai-vokasional', peg.vokasional);
            }

            if (peg.asrama) {
                document.querySelector('input[name="modal-is-pengasuh"][value="ya"]').checked = true;
                toggleModalAsramaOption(true);
                ensureOption('pegawai-asrama', peg.asrama);
            }

            renderPhotoPreview('pegawai-foto-preview', peg.foto, peg.nama);
            document.getElementById('modal-pegawai-title').innerText = 'Edit Data Pegawai';
        }
    }
    document.getElementById('modal-pegawai').classList.remove('hidden');
}

function closePegawaiModal() { document.getElementById('modal-pegawai').classList.add('hidden'); }
function editPegawai(id) { openPegawaiModal(id); }

function openPerkembanganModal(editId = null) {
    document.getElementById('form-perkembangan').reset();
    document.getElementById('perkembangan-id').value = '';
    document.getElementById('modal-perkembangan-title').innerText = 'Catat Rekam Perkembangan';
    renderPhotoPreview('perkembangan-foto-preview', '', '');
    updateDropdownOptions();

    const ensureSelectOption = (selectId, value) => {
        if (!value) return;
        const select = document.getElementById(selectId);
        if (!select) return;
        if (!Array.from(select.options).some(opt => opt.value === value)) {
            select.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`);
        }
        select.value = value;
    };

    if (editId) {
        const perk = dataPerkembangan.find(p => str(p.id) === str(editId));
        if (perk) {
            document.getElementById('perkembangan-id').value = perk.id;
            ensureSelectOption('perkembangan-pm', perk.pmId);
            document.getElementById('perkembangan-tanggal').value = toDateTimeLocalValue(perk.tanggal);
            ensureSelectOption('perkembangan-petugas', perk.petugas);
            updatePerkembanganKategoriOptions();
            ensureSelectOption('perkembangan-kategori', perk.kategori);
            document.getElementById('perkembangan-deskripsi').value = perk.deskripsi;
            document.getElementById('perkembangan-rekomendasi').value = perk.rekomendasi;
            renderPhotoPreview('perkembangan-foto-preview', perk.foto, 'Dokumentasi');
            document.getElementById('modal-perkembangan-title').innerText = 'Edit Rekam Perkembangan';
        }
    } else {
        const now = new Date();
        document.getElementById('perkembangan-tanggal').value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    }
    document.getElementById('modal-perkembangan').classList.remove('hidden');
}

function closePerkembanganModal() { document.getElementById('modal-perkembangan').classList.add('hidden'); }
function editPerkembangan(id) {
    const rec = dataPerkembangan.find(p => str(p.id) === str(id));
    if (rec && rec.penilaianAsrama) {
        openAsramaAssessmentModal(id);
        return;
    }
    openPerkembanganModal(id);
}

function compressImage(file, callback) {
    if (!file || !/^image\//i.test(file.type)) {
        alert('Berkas yang dipilih bukan gambar yang valid.');
        return;
    }

    // Batas aman agar base64 muat di satu sel Google Sheets (limit 50.000 karakter).
    const MAX_CHARS = 45000;
    const maxWidth = 600;
    const maxHeight = 800;

    const reader = new FileReader();
    reader.onerror = () => alert('Gagal membaca berkas gambar.');
    reader.onload = function(event) {
        const img = new Image();
        img.onerror = () => alert('Gambar tidak dapat diproses.');
        img.onload = function() {
            let width = img.naturalWidth || img.width;
            let height = img.naturalHeight || img.height;

            if (!width || !height) {
                alert('Ukuran gambar tidak valid.');
                return;
            }

            if (width > height && width > maxWidth) {
                height = Math.round(height * maxWidth / width);
                width = maxWidth;
            } else if (height >= width && height > maxHeight) {
                width = Math.round(width * maxHeight / height);
                height = maxHeight;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const draw = (w, h) => {
                canvas.width = w;
                canvas.height = h;
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
            };

            let dataUrl = '';
            const scales = [1, 0.82, 0.65, 0.5];

            for (const scale of scales) {
                draw(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
                let quality = 0.8;
                dataUrl = canvas.toDataURL('image/jpeg', quality);

                while (dataUrl.length > MAX_CHARS && quality > 0.42) {
                    quality -= 0.08;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }

                if (dataUrl.length <= MAX_CHARS) break;
            }

            callback(dataUrl);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function bindPhotoPreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;

    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) {
            preview.innerHTML = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = event => {
            preview.innerHTML = `<img src="${esc(event.target.result)}" alt="Pratinjau foto" class="w-20 h-24 object-cover rounded-xl border border-slate-200 shadow-sm">`;
        };
        reader.readAsDataURL(file);
    });
}

function renderPhotoPreview(previewId, foto, nama) {
    const preview = document.getElementById(previewId);
    if (!preview) return;
    preview.innerHTML = isUsablePhoto(foto)
        ? photoThumbHtml(foto, nama, 'w-20 h-24', 'shadow-sm')
        : '';
}

function openImagePreview(src) {
    const modal = document.getElementById('modal-image-preview');
    const img = document.getElementById('modal-image-preview-img');
    if (!modal || !img || !src) return;
    img.src = src;
    modal.classList.remove('hidden');
}

function closeImagePreview() {
    const modal = document.getElementById('modal-image-preview');
    const img = document.getElementById('modal-image-preview-img');
    if (img) img.removeAttribute('src');
    if (modal) modal.classList.add('hidden');
}

/* --- EKSPOR DATA KE CSV --- */
function csvCell(value) {
    const text = str(value).replace(/\r?\n/g, ' ').trim();
    return `"${text.replace(/"/g, '""')}"`;
}

function downloadCSV(filename, rows) {
    if (!rows || rows.length === 0) {
        showToast('Tidak ada data untuk diekspor.');
        return;
    }
    const content = rows.map(row => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${rows.length - 1} baris data.`);
}

function exportPMCSV() {
    const rows = [[
        'No', 'Nama PM', 'Nama Ibu', 'Jenis Kelamin', 'Kasus', 'Vokasional',
        'Penempatan Residensial', 'Status Legal', 'Peksos Pendamping', 'Tgl Masuk',
        'Tgl Terminasi', 'Akun Pembuat'
    ]];
    lastFilteredPMList.forEach((pm, index) => {
        rows.push([
            index + 1, pm.nama, pm.ibu, pm.jk, pm.kasus, pm.vokasional,
            pm.asrama, pm.status, pm.peksos, formatDateOnly(pm.masuk),
            pm.terminasi ? formatDateOnly(pm.terminasi) : '-', pm.createdByAccount
        ]);
    });
    downloadCSV(`Data-PM-Sentra-Handayani-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportPegawaiCSV() {
    const rows = [[
        'No', 'Nama Pegawai', 'NIP', 'Jabatan', 'Kelompok Kerja', 'Vokasional',
        'Pengasuh Asrama', 'Akun Linked'
    ]];
    lastFilteredPegawaiList.forEach((peg, index) => {
        rows.push([
            index + 1, peg.nama, peg.nip, peg.jabatan, peg.pokja, peg.vokasional,
            peg.asrama, findLinkedAccount(peg) || '-'
        ]);
    });
    downloadCSV(`Data-Pegawai-Sentra-Handayani-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportPerkembanganCSV() {
    const rows = [[
        'No', 'Tanggal & Jam', 'Nama PM', 'Kategori', 'Deskripsi',
        'Rekomendasi', 'Petugas Pencatat', 'Dibuat Oleh'
    ]];
    lastFilteredPerkembanganList.forEach((rec, index) => {
        const pm = dataPM.find(item => str(item.id) === str(rec.pmId));
        rows.push([
            index + 1, formatDateWithTime(rec.tanggal), pm ? pm.nama : 'PM Terhapus',
            rec.kategori, rec.deskripsi, rec.rekomendasi, rec.petugas, rec.createdByAccount
        ]);
    });
    downloadCSV(`Rekam-Perkembangan-PM-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 3000);
}

function toggleLaporanType() {
    const type = document.getElementById('select-tipe-laporan').value;
    const pmWrapper = document.getElementById('wrapper-select-pm');
    const peksosWrapper = document.getElementById('wrapper-select-peksos');
    const kasusWrapper = document.getElementById('wrapper-select-kasus');
    const vokasionalWrapper = document.getElementById('wrapper-select-vokasional');
    const asramaWrapper = document.getElementById('wrapper-select-asrama');
    
    const secIndividu = document.getElementById('report-section-individu');
    const secRekap = document.getElementById('report-section-rekapitulasi');
    const secDetail = document.getElementById('report-section-detail-perkembangan');

    pmWrapper.classList.add('hidden');
    peksosWrapper.classList.add('hidden');
    kasusWrapper.classList.add('hidden');
    vokasionalWrapper.classList.add('hidden');
    asramaWrapper.classList.add('hidden');

    secIndividu.classList.add('hidden');
    secRekap.classList.add('hidden');
    secDetail.classList.add('hidden');

    // Instrumen asrama membawa blok tanda tangan sendiri (4 peran).
    const globalSignature = document.getElementById('report-global-signature');
    if (globalSignature) globalSignature.classList.toggle('hidden', type === 'asrama');

    if (currentUser && currentUser.role !== 'admin') {
        const myPegawai = getMyPegawai();
        if (myPegawai) {
            if (type === 'vokasional' && myPegawai.vokasional) {
                const selectVok = document.getElementById('select-laporan-vokasional');
                if (selectVok) {
                    selectVok.value = myPegawai.vokasional;
                    selectVok.setAttribute('disabled', 'true');
                }
            }
            if (type === 'asrama' && myPegawai.asrama) {
                const selectAsrama = document.getElementById('select-laporan-asrama');
                if (selectAsrama) {
                    selectAsrama.value = myPegawai.asrama;
                    selectAsrama.setAttribute('disabled', 'true');
                }
            }
            if (type === 'peksos') {
                const selectPeksos = document.getElementById('select-laporan-peksos');
                if (selectPeksos) {
                    selectPeksos.value = myPegawai.nama;
                    selectPeksos.setAttribute('disabled', 'true');
                }
            }
        }
    } else {
        const selectVok = document.getElementById('select-laporan-vokasional');
        const selectAsrama = document.getElementById('select-laporan-asrama');
        const selectPeksos = document.getElementById('select-laporan-peksos');
        if (selectVok) selectVok.removeAttribute('disabled');
        if (selectAsrama) selectAsrama.removeAttribute('disabled');
        if (selectPeksos) selectPeksos.removeAttribute('disabled');
    }

    if (type === 'individu') {
        pmWrapper.classList.remove('hidden');
        secIndividu.classList.remove('hidden');
        generateReport();
    } else if (type === 'peksos') {
        peksosWrapper.classList.remove('hidden');
        secRekap.classList.remove('hidden');
        generateFilterReport();
    } else if (type === 'kasus') {
        kasusWrapper.classList.remove('hidden');
        secRekap.classList.remove('hidden');
        generateFilterReport();
    } else if (type === 'vokasional') {
        vokasionalWrapper.classList.remove('hidden');
        secDetail.classList.remove('hidden');
        generateFilterReport();
    } else if (type === 'asrama') {
        asramaWrapper.classList.remove('hidden');
        secDetail.classList.remove('hidden');
        generateFilterReport();
    } else if (type === 'rekapitulasi') {
        secRekap.classList.remove('hidden');
        generateRekapitulasiReport();
    }
}

function generateFilterReport() {
    const type = document.getElementById('select-tipe-laporan').value;
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('report-rekap-print-date').innerText = todayStr;
    document.getElementById('report-detail-print-date').innerText = todayStr;
    document.getElementById('report-ttd-date').innerText = todayStr;

    const ttdKananLabel = document.getElementById('report-ttd-kanan-label');

    if (type === 'peksos') {
        const selectedPeksos = document.getElementById('select-laporan-peksos').value;
        const filteredPM = getScopedReportPMs(pm => pm.peksos === selectedPeksos);
        document.getElementById('report-rekap-title').innerText = "LAPORAN REKAPITULASI PM BERDASARKAN PEKSOS PENDAMPING";
        document.getElementById('report-rekap-subtitle').innerText = `Pekerja Sosial Pendamping: ${selectedPeksos}`;
        ttdKananLabel.innerText = "Pekerja Sosial Pendamping";

        const peksosObj = dataPegawai.find(p => p.nama === selectedPeksos);
        document.getElementById('report-ttd-peksos-nama').innerText = selectedPeksos;
        document.getElementById('report-ttd-peksos-nip').innerText = peksosObj ? peksosObj.nip : '-';
        renderFilteredTable(filteredPM);
    } else if (type === 'kasus') {
        const selectedKasus = document.getElementById('select-laporan-kasus').value;
        const filteredPM = getScopedReportPMs(pm => pm.kasus === selectedKasus);
        document.getElementById('report-rekap-title').innerText = "LAPORAN REKAPITULASI PM BERDASARKAN KATEGORI KASUS";
        document.getElementById('report-rekap-subtitle').innerText = `Kategori Kasus: ${selectedKasus}`;
        ttdKananLabel.innerText = "Pekerja Sosial Pendamping";

        document.getElementById('report-ttd-peksos-nama').innerText = "Pekerja Sosial Pendamping";
        document.getElementById('report-ttd-peksos-nip').innerText = "-";
        renderFilteredTable(filteredPM);
    } else if (type === 'vokasional') {
        const selectedVok = document.getElementById('select-laporan-vokasional').value;
        const filteredPM = getScopedReportPMs(pm => pm.vokasional === selectedVok);
        document.getElementById('report-detail-title').innerText = "LAPORAN HASIL PENILAIAN PERKEMBANGAN PM BERDASARKAN VOKASIONAL";
        document.getElementById('report-detail-subtitle').innerText = `Bidang Vokasional: ${selectedVok}`;
        ttdKananLabel.innerText = "Instruktur Vokasional";

        const instrukturObj = dataPegawai.find(p => p.vokasional === selectedVok);
        if (instrukturObj) {
            document.getElementById('report-ttd-peksos-nama').innerText = instrukturObj.nama;
            document.getElementById('report-ttd-peksos-nip').innerText = instrukturObj.nip;
        } else {
            document.getElementById('report-ttd-peksos-nama').innerText = `Instruktur ${selectedVok}`;
            document.getElementById('report-ttd-peksos-nip').innerText = "-";
        }
        renderDetailPerkembanganTable(filteredPM, 'Vokasional');
    } else if (type === 'asrama') {
        const selectedAsrama = document.getElementById('select-laporan-asrama').value;
        const filteredPM = getScopedReportPMs(pm => isSameAsrama(pm.asrama, selectedAsrama));
        document.getElementById('report-detail-title').innerText = "INSTRUMEN EVALUASI & PERKEMBANGAN PM DI ASRAMA";
        document.getElementById('report-detail-subtitle').innerText = `Penempatan Residensial: ${selectedAsrama} — menampilkan instrumen penilaian terakhir per PM`;
        ttdKananLabel.innerText = "Pengasuh Asrama Residensial";

        const pengasuhObj = dataPegawai.find(p =>
            isSameAsrama(p.asrama, selectedAsrama) && normalizeJabatan(p.jabatan).includes('pengasuh'));
        if (pengasuhObj) {
            document.getElementById('report-ttd-peksos-nama').innerText = pengasuhObj.nama;
            document.getElementById('report-ttd-peksos-nip').innerText = pengasuhObj.nip;
        } else {
            document.getElementById('report-ttd-peksos-nama').innerText = `Pengasuh ${selectedAsrama}`;
            document.getElementById('report-ttd-peksos-nip').innerText = "-";
        }
        renderAsramaAssessmentReport(filteredPM, selectedAsrama);
    }
}

function getAsramaReportSignatures(pm, data) {
    const findPegawai = keyword => dataPegawai.find(peg => normalizeJabatan(peg.jabatan).includes(keyword));
    return {
        pengasuh: data.pengasuh || (findPegawai('pengasuh') || {}).nama || '-',
        peksos: data.peksos || pm.peksos || '-',
        penanggung: ASRAMA_PENANGGUNG_PENGASUHAN,
        kapokja: (findPegawai('ketua pokja') || {}).nama || 'Tuti Nurhayati'
    };
}

function renderAsramaAssessmentReport(listPM, selectedAsrama) {
    const container = document.getElementById('report-detail-container');
    container.innerHTML = '';

    if (listPM.length === 0) {
        container.innerHTML = `<div class="p-4 border text-center text-slate-400 italic">Tidak ada Penerima Manfaat pada asrama ${esc(selectedAsrama)}.</div>`;
        return;
    }

    listPM.forEach(pm => {
        let records = dataPerkembangan.filter(rec =>
            str(rec.pmId) === str(pm.id) &&
            rec.kategori === ASRAMA_KATEGORI &&
            rec.penilaianAsrama &&
            Array.isArray(rec.penilaianAsrama.indikator)
        );

        if (currentUser && currentUser.role !== 'admin') {
            records = records.filter(rec => str(rec.createdByAccount) === currentUser.username);
        }
        records.sort((a, b) => (parseDateSafe(b.tanggal) || 0) - (parseDateSafe(a.tanggal) || 0));

        const card = document.createElement('div');
        card.className = 'asrama-report-card border border-slate-300 rounded-lg p-4 bg-white/90 space-y-3 shadow-sm';

        if (records.length === 0) {
            card.innerHTML = `
                <div class="flex justify-between items-center border-b pb-2">
                    <h5 class="font-bold text-sm text-slate-900">${esc(pm.nama)}</h5>
                    <span class="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">${esc(pm.asrama || '-')}</span>
                </div>
                <p class="text-[11px] text-slate-400 italic">Belum ada instrumen penilaian asrama${currentUser && currentUser.role !== 'admin' ? ' dari akun Anda' : ''} untuk PM ini.</p>
            `;
            container.appendChild(card);
            return;
        }

        const latest = records[0];
        const data = latest.penilaianAsrama;
        const items = data.indikator || [];
        const total = Number(data.total) || items.reduce((sum, item) => sum + (Number(item.nilai) || 0), 0);
        const rataRata = Number(data.rataRata) || (items.length ? total / items.length : 0);
        const predikat = data.predikat || getAsramaPredikat(rataRata).label;
        const signatures = getAsramaReportSignatures(pm, data);
        const skala = data.keberfungsian || '';
        const tindakLanjut = data.tindakLanjut || '';

        const layananHtml = ASRAMA_LAYANAN.map(item => {
            const checked = (data.layanan || []).includes(item);
            return `<p class="flex items-start gap-1.5 text-[10px] leading-snug ${checked ? 'text-slate-800' : 'text-slate-400'}">
                <span class="flex-none font-bold">${checked ? '☑' : '☐'}</span><span>${esc(item)}</span>
            </p>`;
        }).join('');

        const keberfungsianHtml = ASRAMA_KEBERFUNGSIAN.map(item => `
            <p class="flex items-start gap-1.5 text-[10px] leading-snug ${item === skala ? 'font-bold text-slate-900' : 'text-slate-500'}">
                <span class="flex-none">${item === skala ? '☑' : '☐'}</span><span>${esc(item)}</span>
            </p>`).join('');

        const tindakLanjutHtml = ASRAMA_TINDAK_LANJUT.map(item => `
            <p class="flex items-start gap-1.5 text-[10px] leading-snug ${item === tindakLanjut ? 'font-bold text-slate-900' : 'text-slate-500'}">
                <span class="flex-none">${item === tindakLanjut ? '☑' : '☐'}</span><span>${esc(item)}</span>
            </p>`).join('');

        card.innerHTML = `
            <div class="text-center border-b-2 border-slate-800 pb-2">
                <h4 class="font-extrabold text-sm uppercase tracking-wide">INSTRUMEN EVALUASI &amp; PERKEMBANGAN PENERIMA MANFAAT DI ASRAMA</h4>
                <p class="text-[10px] text-slate-600 mt-0.5">Tanggal Penilaian: <strong>${formatDateWithTime(latest.tanggal)}</strong></p>
            </div>

            <div>
                <p class="font-bold text-[10px] uppercase tracking-wider border-b border-slate-300 pb-0.5 mb-1.5">I. Identitas Penerima Manfaat &amp; Petugas</p>
                <div class="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px] leading-snug">
                    <p><span class="text-slate-500">Nama PM:</span> <strong>${esc(pm.nama)}</strong></p>
                    <p><span class="text-slate-500">Asrama:</span> <strong>${esc(data.asrama || pm.asrama || '-')}</strong></p>
                    <p><span class="text-slate-500">Tanggal Masuk:</span> <strong>${pm.masuk ? formatDateOnly(pm.masuk) : '-'}</strong></p>
                    <p><span class="text-slate-500">Pengasuh Asrama:</span> <strong>${esc(signatures.pengasuh)}</strong></p>
                    <p><span class="text-slate-500">Pekerja Sosial:</span> <strong>${esc(signatures.peksos)}</strong></p>
                    <p><span class="text-slate-500">Klaster PM:</span> <strong>${esc(normalizeAsramaKlaster(data.klaster)) || '-'}</strong></p>
                </div>
            </div>

            <div>
                <p class="font-bold text-[10px] uppercase tracking-wider border-b border-slate-300 pb-0.5 mb-1.5">II. Evaluasi Perkembangan PM Asrama</p>
                <table class="w-full border-collapse border border-slate-400 text-[10px]">
                    <thead>
                        <tr class="bg-slate-100">
                            <th class="border border-slate-400 p-1.5 text-center w-7">No</th>
                            <th class="border border-slate-400 p-1.5 text-left w-52">Indikator / Aspek Perkembangan</th>
                            <th class="border border-slate-400 p-1.5 text-center w-10">Nilai</th>
                            <th class="border border-slate-400 p-1.5 text-left">Catatan Perilaku &amp; Intervensi Pengasuh</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, index) => `
                            <tr>
                                <td class="border border-slate-400 p-1.5 text-center font-mono">${index + 1}</td>
                                <td class="border border-slate-400 p-1.5 font-semibold align-top">${esc(item.nama)}</td>
                                <td class="border border-slate-400 p-1.5 text-center align-top">
                                    <span class="inline-flex w-5 h-5 items-center justify-center rounded border text-[10px] font-extrabold ${getAsramaNilaiBadgeClass(Number(item.nilai))}">${item.nilai}</span>
                                </td>
                                <td class="border border-slate-400 p-1.5 align-top whitespace-pre-line">${esc(item.catatan) || '-'}</td>
                            </tr>
                        `).join('')}
                        <tr class="bg-slate-50 font-bold">
                            <td colspan="2" class="border border-slate-400 p-1.5 text-right uppercase">Total Nilai</td>
                            <td class="border border-slate-400 p-1.5 text-center">${total}</td>
                            <td class="border border-slate-400 p-1.5 font-normal">Rata-rata ${rataRata.toFixed(2)} dari 4,00 · Predikat: <strong>${esc(predikat)}</strong></td>
                        </tr>
                    </tbody>
                </table>
                <div class="text-[9px] text-slate-600 leading-snug border border-slate-300 border-t-0 p-1.5 bg-slate-50">
                    <strong>Keterangan Nilai:</strong>
                    ${ASRAMA_SKALA.map(item => `<strong>${item.nilai} (${esc(item.label)})</strong>: ${esc(item.deskripsi)}`).join(' ')}
                </div>
            </div>

            <div>
                <p class="font-bold text-[10px] uppercase tracking-wider border-b border-slate-300 pb-0.5 mb-1.5">III. Layanan yang Sudah Diberikan</p>
                <div class="space-y-1">${layananHtml}</div>
            </div>

            <div>
                <p class="font-bold text-[10px] uppercase tracking-wider border-b border-slate-300 pb-0.5 mb-1.5">IV. Kesimpulan &amp; Rekomendasi Pekerja Sosial</p>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="font-semibold text-[10px] mb-1">Tingkat Keberfungsian Sosial saat ini:</p>
                        <div class="space-y-1">${keberfungsianHtml}</div>
                    </div>
                    <div>
                        <p class="font-semibold text-[10px] mb-1">Rekomendasi tindak lanjut (TL):</p>
                        <div class="space-y-1">${tindakLanjutHtml}</div>
                    </div>
                </div>
                <div class="mt-2 text-[10px] leading-snug">
                    <span class="font-semibold">Catatan tambahan / kesimpulan pengasuh:</span>
                    <p class="whitespace-pre-line mt-0.5">${esc(data.catatanTambahan) || '-'}</p>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-x-8 gap-y-6 pt-3 text-[10px] text-center">
                <div>
                    <p class="text-slate-600">Pengasuh Asrama,</p>
                    <p class="font-bold underline mt-10">${esc(signatures.pengasuh)}</p>
                </div>
                <div>
                    <p class="text-slate-600">Pekerja Sosial,</p>
                    <p class="font-bold underline mt-10">${esc(signatures.peksos)}</p>
                </div>
                <div>
                    <p class="text-slate-600">Penanggungjawab Pengasuhan,</p>
                    <p class="font-bold underline mt-10">${esc(signatures.penanggung)}</p>
                </div>
                <div>
                    <p class="text-slate-600">Kapokja Residensial,</p>
                    <p class="font-bold underline mt-10">${esc(signatures.kapokja)}</p>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    const KetuaPokjaObj = dataPegawai.find(p => p.jabatan === 'Ketua Pokja');
    if (KetuaPokjaObj) {
        document.getElementById('report-ttd-pokja-nama').innerText = KetuaPokjaObj.nama;
        document.getElementById('report-ttd-pokja-nip').innerText = KetuaPokjaObj.nip;
    } else {
        document.getElementById('report-ttd-pokja-nama').innerText = 'Tuti Nurhayati';
        document.getElementById('report-ttd-pokja-nip').innerText = '198401182010122001';
    }
}

function renderDetailPerkembanganTable(listPM, kategoriFilter = null) {
    const container = document.getElementById('report-detail-container');
    container.innerHTML = '';

    if (listPM.length === 0) {
        container.innerHTML = `<div class="p-4 border text-center text-slate-400 italic">Tidak ada Penerima Manfaat pada kategori ini.</div>`;
        return;
    }

    listPM.forEach(pm => {
        let pmPerkembangan = dataPerkembangan.filter(p => p.pmId === pm.id);
        
        if (currentUser && currentUser.role !== 'admin') {
            pmPerkembangan = pmPerkembangan.filter(p => p.createdByAccount === currentUser.username);
        }

        if (kategoriFilter) {
            pmPerkembangan = pmPerkembangan.filter(p => p.kategori === kategoriFilter);
        }
        pmPerkembangan.sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));

        const pmCard = document.createElement('div');
        pmCard.className = "border border-slate-300 rounded-xl p-4 bg-white/90 space-y-3 shadow-sm";
        
        let htmlContent = `
            <div class="flex justify-between items-center border-b pb-2 font-sans">
                <div>
                    <h5 class="font-bold text-sm text-slate-900">${esc(pm.nama)}</h5>
                    <p class="text-[11px] text-slate-500">Ibu Kandung: ${esc(pm.ibu)} | Kasus: ${esc(pm.kasus)}</p>
                </div>
                <div class="text-right text-[11px]">
                    <span class="font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full">${esc(pm.vokasional) || '-'}</span>
                    <span class="font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full ml-1">${esc(pm.asrama) || 'Non-Residensial'}</span>
                </div>
            </div>
            <table class="w-full border-collapse border border-slate-300 text-xs font-sans">
                <thead>
                    <tr class="bg-slate-100 text-slate-700">
                        <th class="border border-slate-300 p-2 w-36">Tanggal & Waktu</th>
                        <th class="border border-slate-300 p-2 w-32">Kategori</th>
                        <th class="border border-slate-300 p-2">Deskripsi Perkembangan</th>
                        <th class="border border-slate-300 p-2 w-36">Petugas</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (pmPerkembangan.length === 0) {
            htmlContent += `<tr><td colspan="4" class="border border-slate-300 p-3 text-center text-slate-400 italic">Belum ada catatan rekam perkembangan bidang terkait dari akun Anda.</td></tr>`;
        } else {
            pmPerkembangan.forEach(p => {
                htmlContent += `
                    <tr>
                        <td class="border border-slate-300 p-2 font-mono align-top">${formatDateWithTime(p.tanggal)}</td>
                        <td class="border border-slate-300 p-2 font-semibold align-top">${esc(p.kategori)}</td>
                        <td class="border border-slate-300 p-2 align-top">
                            <p class="whitespace-pre-line">${esc(p.deskripsi)}</p>
                            ${p.rekomendasi ? `<p class="mt-1 text-slate-600 italic"><strong>Rekomendasi:</strong> ${esc(p.rekomendasi)}</p>` : ''}
                            ${isUsablePhoto(p.foto) ? `<div class="mt-2"><img src="${esc(p.foto)}" alt="Foto Perkembangan" class="max-w-[150px] max-h-[150px] object-cover rounded border shadow-sm"></div>` : ''}
                        </td>
                        <td class="border border-slate-300 p-2 align-top font-medium">${esc(p.petugas)}</td>
                    </tr>
                `;
            });
        }

        htmlContent += `</tbody></table>`;
        pmCard.innerHTML = htmlContent;
        container.appendChild(pmCard);
    });

    const KetuaPokjaObj = dataPegawai.find(p => p.jabatan === 'Ketua Pokja');
    if(KetuaPokjaObj) {
        document.getElementById('report-ttd-pokja-nama').innerText = KetuaPokjaObj.nama;
        document.getElementById('report-ttd-pokja-nip').innerText = KetuaPokjaObj.nip;
    } else {
        document.getElementById('report-ttd-pokja-nama').innerText = 'Tuti Nurhayati';
        document.getElementById('report-ttd-pokja-nip').innerText = '198401182010122001';
    }
}

function generateRekapitulasiReport() {
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('report-rekap-print-date').innerText = todayStr;
    document.getElementById('report-ttd-date').innerText = todayStr;

    let targetDataPM = scopeReportPMList(dataPM);

    if (currentUser && currentUser.role !== 'admin') {
        document.getElementById('report-rekap-title').innerText = "LAPORAN REKAPITULASI DATA PM (PRIBADI PETUGAS)";
        document.getElementById('report-rekap-subtitle').innerText = `Daftar PM yang Anda nilai atau tambahkan (Akun: ${currentUser.username})`;
    } else {
        document.getElementById('report-rekap-title').innerText = "LAPORAN REKAPITULASI DATABASE & REKAM PERKEMBANGAN PM";
        document.getElementById('report-rekap-subtitle').innerText = "Seluruh Data Penerima Manfaat Sentra Handayani (Akses Master Admin)";
    }

    document.getElementById('report-ttd-kanan-label').innerText = "Pekerja Sosial Pendamping";
    renderFilteredTable(targetDataPM);
}

function renderFilteredTable(listPM) {
    const tbody = document.getElementById('report-rekapitulasi-body');
    tbody.innerHTML = '';

    if (listPM.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="border border-slate-300 p-4 text-center text-slate-400 italic">Tidak ada data Penerima Manfaat.</td></tr>`;
        return;
    }

    listPM.forEach((pm, index) => {
        let pmPerkembangan = dataPerkembangan.filter(p => p.pmId === pm.id);
        if (currentUser && currentUser.role !== 'admin') {
            pmPerkembangan = pmPerkembangan.filter(p => p.createdByAccount === currentUser.username);
        }

        pmPerkembangan.sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));
        const lastUpdate = pmPerkembangan.length > 0 ? formatDateWithTime(pmPerkembangan[0].tanggal) : '-';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="border border-slate-300 p-2 text-center font-mono">${index + 1}</td>
            <td class="border border-slate-300 p-2 font-bold">${esc(pm.nama)}<br><span class="text-slate-500 text-[10px]">Ibu: ${esc(pm.ibu)}</span></td>
            <td class="border border-slate-300 p-2">${esc(pm.kasus)}</td>
            <td class="border border-slate-300 p-2">${esc(pm.status)}</td>
            <td class="border border-slate-300 p-2">${esc(pm.peksos)}</td>
            <td class="border border-slate-300 p-2 text-center font-bold">${pmPerkembangan.length}</td>
            <td class="border border-slate-300 p-2 font-mono text-center">${lastUpdate}</td>
        `;
        tbody.appendChild(tr);
    });

    const KetuaPokjaObj = dataPegawai.find(p => p.jabatan === 'Ketua Pokja');
    if(KetuaPokjaObj) {
        document.getElementById('report-ttd-pokja-nama').innerText = KetuaPokjaObj.nama;
        document.getElementById('report-ttd-pokja-nip').innerText = KetuaPokjaObj.nip;
    } else {
        document.getElementById('report-ttd-pokja-nama').innerText = 'Tuti Nurhayati';
        document.getElementById('report-ttd-pokja-nip').innerText = '198401182010122001';
    }
}

function getMyAssessedPmIds() {
    if (!currentUser) return new Set();
    return new Set(
        dataPerkembangan
            .filter(rec => str(rec.createdByAccount) === currentUser.username)
            .map(rec => str(rec.pmId))
    );
}

/* Laporan non-admin dibatasi pada PM yang mereka nilai atau tambahkan sendiri. */
function scopeReportPMList(listPM) {
    if (!currentUser || currentUser.role === 'admin') return listPM;
    const myPmIds = getMyAssessedPmIds();
    return listPM.filter(pm => myPmIds.has(str(pm.id)) || str(pm.createdByAccount) === currentUser.username);
}

/* Admin tetap memakai filter laporan; non-admin selalu dibatasi ke data yang ia nilai. */
function getScopedReportPMs(predicate) {
    if (!currentUser || currentUser.role === 'admin') return dataPM.filter(predicate);
    return scopeReportPMList(dataPM);
}

function populateLaporanSelect() {
    const selectPM = document.getElementById('select-laporan-pm');
    if (!selectPM) return;

    const targetPMList = scopeReportPMList(dataPM);

    const previousPM = selectPM.value;
    selectPM.innerHTML = targetPMList.length
        ? targetPMList.map(pm => `<option value="${esc(pm.id)}">${esc(pm.nama)} (${esc(pm.kasus)})</option>`).join('')
        : `<option value="">Belum ada data PM</option>`;

    if (previousPM && Array.from(selectPM.options).some(opt => opt.value === previousPM)) {
        selectPM.value = previousPM;
    }

    refreshDynamicOptions();
}

function generateReport() {
    const pmId = document.getElementById('select-laporan-pm').value;
    const pm = dataPM.find(p => str(p.id) === str(pmId));

    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('report-print-date').innerText = todayStr;
    document.getElementById('report-ttd-date').innerText = todayStr;
    document.getElementById('report-ttd-kanan-label').innerText = "Pekerja Sosial Pendamping";

    const imgEl = document.getElementById('report-pm-photo');
    const iconEl = document.getElementById('report-pm-photo-icon');
    const reportTbody = document.getElementById('report-perkembangan-body');

    if (!pm) {
        ['report-pm-nama', 'report-pm-ibu', 'report-pm-jk', 'report-pm-kasus', 'report-pm-vokasional',
         'report-pm-asrama', 'report-pm-status', 'report-pm-peksos', 'report-pm-masuk', 'report-pm-terminasi']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerText = '-';
            });
        if (imgEl) {
            imgEl.removeAttribute('src');
            imgEl.classList.add('hidden');
        }
        if (iconEl) iconEl.classList.remove('hidden');
        if (reportTbody) {
            reportTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">Pilih Penerima Manfaat untuk menampilkan laporan.</td></tr>`;
        }
        document.getElementById('report-ttd-peksos-nama').innerText = '-';
        document.getElementById('report-ttd-peksos-nip').innerText = '-';
        return;
    }

    document.getElementById('report-pm-nama').innerText = pm.nama;
    document.getElementById('report-pm-ibu').innerText = pm.ibu || '-';
    document.getElementById('report-pm-jk').innerText = pm.jk || '-';
    document.getElementById('report-pm-kasus').innerText = pm.kasus || '-';
    document.getElementById('report-pm-vokasional').innerText = pm.vokasional || '-';
    document.getElementById('report-pm-asrama').innerText = pm.asrama || 'Tidak Ada (Non-Residensial)';
    document.getElementById('report-pm-status').innerText = pm.status || '-';
    document.getElementById('report-pm-peksos').innerText = pm.peksos || '-';
    document.getElementById('report-pm-masuk').innerText = formatDateOnly(pm.masuk);
    document.getElementById('report-pm-terminasi').innerText = pm.terminasi ? formatDateOnly(pm.terminasi) : 'Belum Ditentukan';

    if (imgEl) {
        if (isUsablePhoto(pm.foto)) {
            imgEl.src = pm.foto;
            imgEl.classList.remove('hidden');
            if (iconEl) iconEl.classList.add('hidden');
            imgEl.onerror = () => {
                imgEl.classList.add('hidden');
                if (iconEl) iconEl.classList.remove('hidden');
            };
        } else {
            imgEl.removeAttribute('src');
            imgEl.classList.add('hidden');
            if (iconEl) iconEl.classList.remove('hidden');
        }
    }

    const peksosObj = dataPegawai.find(p => p.nama === pm.peksos);
    document.getElementById('report-ttd-peksos-nama').innerText = pm.peksos || 'Pekerja Sosial Pendamping';
    document.getElementById('report-ttd-peksos-nip').innerText = peksosObj ? peksosObj.nip : '-';

    const KetuaPokjaObj = dataPegawai.find(p => p.jabatan === 'Ketua Pokja');
    if (KetuaPokjaObj) {
        document.getElementById('report-ttd-pokja-nama').innerText = KetuaPokjaObj.nama;
        document.getElementById('report-ttd-pokja-nip').innerText = KetuaPokjaObj.nip;
    } else {
        document.getElementById('report-ttd-pokja-nama').innerText = 'Tuti Nurhayati';
        document.getElementById('report-ttd-pokja-nip').innerText = '198401182010122001';
    }

    let pmPerkembangan = dataPerkembangan.filter(p => p.pmId === pmId);
    if (currentUser && currentUser.role !== 'admin') {
        pmPerkembangan = pmPerkembangan.filter(p => p.createdByAccount === currentUser.username);
    }
    pmPerkembangan.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

    if (!reportTbody) return;
    reportTbody.innerHTML = '';

    if (pmPerkembangan.length === 0) {
        reportTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">Belum ada catatan rekam perkembangan yang diinput oleh akun Anda.</td></tr>`;
    } else {
        pmPerkembangan.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="border border-slate-300 p-2 font-mono align-top">${formatDateWithTime(p.tanggal)}</td>
                <td class="border border-slate-300 p-2 font-semibold align-top">${esc(p.kategori)}</td>
                <td class="border border-slate-300 p-2 align-top">
                    <p class="whitespace-pre-line">${esc(p.deskripsi)}</p>
                    ${p.rekomendasi ? `<p class="mt-1 text-slate-600 italic"><strong>Rekomendasi:</strong> ${esc(p.rekomendasi)}</p>` : ''}
                    ${isUsablePhoto(p.foto) ? `<div class="mt-2"><img src="${esc(p.foto)}" alt="Foto Perkembangan" class="max-w-[150px] max-h-[150px] object-cover rounded border shadow-sm"></div>` : ''}
                </td>
                <td class="border border-slate-300 p-2 align-top">${esc(p.petugas)}</td>
            `;
            reportTbody.appendChild(tr);
        });
    }
}

function formatDate(dateString) { return formatDateOnly(dateString); }

const MONTH_NAMES_ID = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function formatDateOnly(dateString) {
    if (!dateString) return '-';
    const dateObj = parseDateSafe(dateString);
    if (!dateObj) return str(dateString);

    return `${pad2(dateObj.getDate())} ${MONTH_NAMES_ID[dateObj.getMonth() + 1]} ${dateObj.getFullYear()}`;
}

function formatDateWithTime(dateString) {
    if (!dateString) return '-';
    const dateObj = parseDateSafe(dateString);
    if (!dateObj) return str(dateString);

    return `${pad2(dateObj.getDate())} ${MONTH_NAMES_ID[dateObj.getMonth() + 1]} ${dateObj.getFullYear()}, ${pad2(dateObj.getHours())}:${pad2(dateObj.getMinutes())}`;
}