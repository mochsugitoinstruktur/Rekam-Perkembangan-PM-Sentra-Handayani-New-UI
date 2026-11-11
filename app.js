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

window.onload = function() {
    initUsersDB();
    loadSession();
    loadDataFromCloud();
    initDarkModeState();

    setInterval(() => {
        loadDataFromCloud();
    }, 5000);
};

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
                    <span class="font-bold text-indigo-700 text-[11px]"><i class="fa-solid fa-circle-user mr-1"></i>${log.user}</span>
                    <span class="text-[10px] text-slate-400 font-mono">${formatDateWithTime(log.time)}</span>
                </div>
                <p class="text-xs text-slate-700 font-medium"><strong>${log.action}:</strong> ${log.desc}</p>
            </div>
        `).join('');
    }
}

function toggleNotificationDropdown() {
    const dropdown = document.getElementById('notif-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }
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

function deleteUserAccount(username) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('Akses ditolak! Hanya Master Admin yang dapat mereset akun.');
        return;
    }

    if (username === 'admin' || username === currentUser.username) {
        alert('Anda tidak dapat menghapus akun master admin yang sedang aktif.');
        return;
    }

    if (!usersDB[username]) {
        alert(`Akun "${username}" tidak ditemukan dalam database.`);
        return;
    }

    if (confirm(`Apakah Anda yakin ingin mereset akun "${username}"? Data pegawai yang terikat akan dihapus, dan akun ini akan kembali menjadi akun baru bersih yang belum terpakai.`)) {
        const associatedPegawai = dataPegawai.find(p => p.createdByAccount === username || (usersDB[username].pegawaiId && p.id === usersDB[username].pegawaiId));
        if (associatedPegawai) {
            dataPegawai = dataPegawai.filter(p => p.id !== associatedPegawai.id);
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
        const isRegistered = acc.pegawaiId !== null || dataPegawai.some(p => p.createdByAccount === username);
        const statusStr = isRegistered ? 'aktif terpakai' : 'belum pernah dipakai baru';
        const linkedPegawai = dataPegawai.find(p => p.createdByAccount === username || (acc.pegawaiId && p.id === acc.pegawaiId));
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
        const isRegistered = acc.pegawaiId !== null || dataPegawai.some(p => p.createdByAccount === username);
        const linkedPegawai = dataPegawai.find(p => p.createdByAccount === username || (acc.pegawaiId && p.id === acc.pegawaiId));

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
                ${linkedPegawai ? `${linkedPegawai.nama} <span class="text-xs text-slate-400 font-normal">(${linkedPegawai.jabatan})</span>` : '<span class="text-slate-400 italic">Belum ada profil</span>'}
            </td>
            <td class="p-3 text-center">
                ${acc.role !== 'admin' ? `
                    <button onclick="deleteUserAccount('${acc.username}')" class="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow transition text-xs">
                        <i class="fa-solid fa-rotate-left mr-1"></i> Reset / Hapus Akun
                    </button>
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
}

function updateJurnalSubTitle() {
    const subTitleEl = document.getElementById('sub-title-jurnal');
    if (!subTitleEl) return;

    if (!currentUser || currentUser.role === 'admin') {
        subTitleEl.innerText = "Rekam perkembangan harian, sosial, medis, psikologis, dan vokasional PM (Akses Admin)";
        return;
    }

    const myPegawai = dataPegawai.find(p => p.id === currentUser.pegawaiId || p.createdByAccount === currentUser.username);
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

function loadSession() {
    const saved = localStorage.getItem('sh_logged_user');

    if (saved) {
        currentUser = JSON.parse(saved);
        if (usersDB[currentUser.username]) {
            currentUser = usersDB[currentUser.username];
        }
        document.getElementById('welcome-screen').classList.add('hidden');
        document.getElementById('login-screen').classList.add('hidden');
        
        const userLabel = document.getElementById('logged-username-label');
        if (userLabel) userLabel.innerText = currentUser.username;
        
        updateAdminUI();
        updateJurnalSubTitle();
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

function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value.trim();

    if (usersDB[u] && usersDB[u].password === p) {
        currentUser = usersDB[u];
        localStorage.setItem('sh_logged_user', JSON.stringify(currentUser));
        
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
            return;
        }

        // Cek apakah pegawai sudah terdaftar berdasarkan NIP khusus Anda atau account binding
        const targetNip = '199205262025061002';
        const myPegawaiByNip = dataPegawai.find(p => p.nip === targetNip || p.createdByAccount === currentUser.username);

        if (!currentUser.pegawaiId && !myPegawaiByNip) {
            document.getElementById('login-box').classList.add('hidden');
            document.getElementById('pegawai-init-box').classList.remove('hidden');
            toggleInitConditionalFields();
        } else {
            if (myPegawaiByNip && !currentUser.pegawaiId) {
                currentUser.pegawaiId = myPegawaiByNip.id;
                usersDB[currentUser.username].pegawaiId = myPegawaiByNip.id;
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
        }
    } else {
        alert('Username atau Password salah!');
    }
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('sh_logged_user');

    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';

    document.getElementById('welcome-screen').classList.remove('hidden');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('tab-admin-btn').classList.add('hidden');
    
    const notifWidget = document.getElementById('system-notif-widget');
    if (notifWidget) notifWidget.classList.add('hidden');
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

        const newPeg = {
            id: newPegId,
            nama: document.getElementById('init-pegawai-nama').value,
            nip: document.getElementById('init-pegawai-nip').value,
            jabatan: jabatanVal,
            pokja: document.getElementById('init-pegawai-pokja').value,
            vokasional: jabatanVal === 'Instruktur' ? document.getElementById('init-pegawai-vokasional').value : '',
            asrama: isPengasuhChecked ? document.getElementById('init-pegawai-asrama').value : '',
            foto: fotoBase64,
            createdByAccount: currentUser.username
        };

        dataPegawai.push(newPeg);
        usersDB[currentUser.username].pegawaiId = newPegId;
        currentUser.pegawaiId = newPegId;
        localStorage.setItem('sh_logged_user', JSON.stringify(currentUser));

        saveData();
        renderPegawaiTable();
        updateDropdownOptions();
        updateJurnalSubTitle();

        document.getElementById('login-screen').classList.add('hidden');
        const userLabel = document.getElementById('logged-username-label');
        if (userLabel) userLabel.innerText = currentUser.username;
        
        switchTab('pm');
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
    const statusEl = document.getElementById('sync-status');
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("GANTI_DENGAN")) {
        statusEl.className = "text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
        statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> URL Belum Diset`;
        initDefaultData();
        return;
    }

    try {
        const response = await fetch(APPS_SCRIPT_URL);
        const result = await response.json();

        if (result && result.pm) {
            const previousCount = dataPerkembangan.length;

            dataPM = result.pm;
            dataPegawai = result.pegawai || [];
            dataPerkembangan = result.perkembangan || [];
            
            if (result.usersDB) usersDB = Object.assign(usersDB, result.usersDB);
            if (result.pwdRequests) pwdRequests = result.pwdRequests;
            
            if (previousCount > 0 && dataPerkembangan.length > previousCount) {
                showToast(`Ada ${dataPerkembangan.length - previousCount} catatan rekam perkembangan baru masuk!`);
                const newBadge = document.getElementById('perkembangan-new-badge');
                if (newBadge) newBadge.classList.remove('hidden');
                addSystemLog('Data Baru', `Masuk ${dataPerkembangan.length - previousCount} catatan rekam perkembangan baru.`);
            }

            statusEl.className = "text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
            statusEl.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Terhubung ke Cloud`;
        } else {
            initDefaultData();
        }
    } catch (error) {
        console.error("Gagal memuat data:", error);
        statusEl.className = "text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5";
        statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Gagal Sinkronisasi`;
        initDefaultData();
    }

    renderPMTable();
    renderPegawaiTable();
    renderPerkembanganTable();
    if (currentUser && currentUser.username === 'admin') {
        renderPwdRequestsTable();
    }
    updateJurnalSubTitle();
    renderCharts();
    updateNotificationWidget();
}

function initDefaultData() {
    dataPM = [
        { id: 'PM001', nama: 'Ananda Rizky', ibu: 'Siti Aminah', jk: 'Laki - Laki', kasus: 'ABH', vokasional: 'Vokasional TIK', asrama: 'Asrama R.A Kartini', status: 'Titipan', peksos: 'Budi Santoso, S.Tr.Sos', masuk: '2024-01-15', terminasi: '2024-07-15', foto: '', createdByAccount: 'user1' }
    ];
    dataPegawai = [
        { id: 'PEG001', nama: 'Budi Santoso, S.Tr.Sos', nip: '198503122010011005', jabatan: 'Pekerja Sosial', pokja: 'Pokja ABH', vokasional: '', asrama: '', foto: '', createdByAccount: 'user1' },
        { id: 'PEG002', nama: 'Moch. Sugito, S.T.', nip: '199205262025061002', jabatan: 'Instruktur', pokja: 'Pokja Residensial', vokasional: 'Vokasional TIK', asrama: '', foto: '', createdByAccount: 'admin' },
        { id: 'PEG003', nama: 'Drs. Ahmad Hidayat, M.Si', nip: '197501011999031001', jabatan: 'Ketua Pokja', pokja: 'Pokja ABH', vokasional: '', asrama: '', foto: '', createdByAccount: 'admin' }
    ];
    dataPerkembangan = [
        { id: 'PER001', pmId: 'PM001', tanggal: '2024-01-20', kategori: 'Perilaku & Disiplin', deskripsi: 'PM mulai menyesuaikan diri.', rekomendasi: 'Konseling rutin.', petugas: 'Budi Santoso, S.Tr.Sos', createdByAccount: 'user1' }
    ];
}

function canUserModify(itemOwnerUsername, itemNip = null) {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    if (itemNip && itemNip === '199205262025061002') return true;
    return itemOwnerUsername === currentUser.username;
}

/* POP-UP DETAIL PENERIMA MANFAAT */
function openViewPMModal(id) {
    const pm = dataPM.find(p => p.id === id);
    if (!pm) return;

    document.getElementById('view-pm-nama').innerText = pm.nama;
    document.getElementById('view-pm-ibu').innerText = `Nama Ibu: ${pm.ibu}`;
    document.getElementById('view-pm-jk').innerText = pm.jk;
    document.getElementById('view-pm-kasus').innerText = pm.kasus;
    document.getElementById('view-pm-status').innerText = pm.status;
    document.getElementById('view-pm-vokasional').innerText = pm.vokasional || 'Tidak Ada';
    document.getElementById('view-pm-asrama').innerText = pm.asrama || 'Non-Residensial';
    document.getElementById('view-pm-peksos').innerText = pm.peksos;
    document.getElementById('view-pm-masuk').innerText = formatDateOnly(pm.masuk);
    document.getElementById('view-pm-terminasi').innerText = pm.terminasi ? formatDateOnly(pm.terminasi) : 'Belum Ditentukan';

    const imgEl = document.getElementById('view-pm-foto');
    if (pm.foto) {
        imgEl.src = pm.foto;
        imgEl.classList.remove('hidden');
    } else {
        imgEl.src = 'https://via.placeholder.com/150?text=No+Foto';
        imgEl.classList.remove('hidden');
    }

    document.getElementById('modal-view-pm').classList.remove('hidden');
}

function closeViewPMModal() {
    document.getElementById('modal-view-pm').classList.add('hidden');
}

function renderPMTable() {
    const tbody = document.getElementById('pm-table-body');
    if(!tbody) return;
    const search = document.getElementById('search-pm').value.toLowerCase();
    tbody.innerHTML = '';

    const filtered = dataPM.filter(pm => 
        (pm.nama && pm.nama.toLowerCase().includes(search)) || 
        (pm.ibu && pm.ibu.toLowerCase().includes(search)) || 
        (pm.kasus && pm.kasus.toLowerCase().includes(search)) ||
        (pm.vokasional && pm.vokasional.toLowerCase().includes(search)) ||
        (pm.asrama && pm.asrama.toLowerCase().includes(search))
    );

    document.getElementById('total-pm-count').innerText = filtered.length;

    filtered.forEach(pm => {
        const isEditable = canUserModify(pm.createdByAccount);
        const tr = document.createElement('tr');
        tr.className = "hover:bg-indigo-50/70 transition border-b border-slate-100 cursor-pointer";
        
        tr.onclick = (e) => {
            if (!e.target.closest('button')) {
                openViewPMModal(pm.id);
            }
        };

        tr.innerHTML = `
            <td class="p-3.5">
                ${pm.foto ? `<img src="${pm.foto}" class="max-w-[70px] max-h-[70px] rounded-xl object-cover border border-slate-200 shadow-sm">` : `<div class="w-10 h-10 bg-indigo-50 text-indigo-700 rounded-xl flex items-center justify-center text-xs font-extrabold border border-indigo-200">${pm.nama ? pm.nama.charAt(0) : 'P'}</div>`}
            </td>
            <td class="p-3.5 font-bold text-slate-900">${pm.nama}<br><span class="text-[11px] text-slate-400 font-normal">Ibu: ${pm.ibu}</span></td>
            <td class="p-3.5"><span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full font-bold text-[11px]"><i class="fa-solid fa-graduation-cap mr-1"></i>${pm.vokasional || '-'}</span></td>
            <td class="p-3.5"><span class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full font-bold text-[11px]"><i class="fa-solid fa-house-chimney mr-1"></i>${pm.asrama || 'Tidak Ada'}</span></td>
            <td class="p-3.5"><span class="px-2.5 py-1 bg-rose-50 text-rose-700 rounded-full font-bold text-[11px]">${pm.kasus}</span></td>
            <td class="p-3.5"><span class="px-2.5 py-1 ${pm.status === 'Putusan' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'} rounded-full font-bold text-[11px]">${pm.status}</span></td>
            <td class="p-3.5 text-slate-700 font-medium">${pm.peksos}</td>
            <td class="p-3.5 text-[11px] font-mono text-slate-500 font-semibold">${pm.createdByAccount || '-'}</td>
            <td class="p-3.5 text-slate-600 font-medium">${formatDate(pm.masuk)}</td>
            <td class="p-3.5 text-slate-600 font-medium">${formatDate(pm.terminasi)}</td>
            <td class="p-3.5 text-center">
                <div class="flex items-center justify-center space-x-2">
                    ${isEditable ? `
                        <button onclick="editPM('${pm.id}')" class="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition shadow-sm" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="deletePM('${pm.id}')" class="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition shadow-sm" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                    ` : `<span class="text-[11px] text-slate-400 font-medium bg-slate-100 px-2 py-1 rounded-lg"><i class="fa-solid fa-lock mr-1"></i> Locked</span>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderCharts();
}

/* POP-UP DETAIL PEGAWAI & PROFIL PRIBADI */
function openViewPegawaiModal(id) {
    const peg = dataPegawai.find(p => p.id === id);
    if (!peg) return;

    document.getElementById('view-pegawai-nama').innerText = peg.nama;
    document.getElementById('view-pegawai-nip').innerText = `NIP. ${peg.nip}`;
    document.getElementById('view-pegawai-jabatan').innerText = peg.jabatan;
    document.getElementById('view-pegawai-pokja').innerText = peg.pokja;
    document.getElementById('view-pegawai-akun').innerText = peg.createdByAccount || '-';

    const imgEl = document.getElementById('view-pegawai-foto');
    if (peg.foto) {
        imgEl.src = peg.foto;
    } else {
        imgEl.src = 'https://via.placeholder.com/150?text=No+Foto';
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
        if (canUserModify(peg.createdByAccount)) {
            editBtnContainer.innerHTML = `<button onclick="closeViewPegawaiModal(); editPegawai('${peg.id}');" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs transition shadow"><i class="fa-solid fa-pen-to-square mr-1"></i> Edit Profil Ini</button>`;
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
    const myPegawai = dataPegawai.find(p => p.nip === '199205262025061002' || p.id === currentUser.pegawaiId || p.createdByAccount === currentUser.username);
    if (myPegawai) {
        openViewPegawaiModal(myPegawai.id);
    } else {
        alert('Anda belum mendaftarkan profil pegawai untuk akun ini.');
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('login-box').classList.add('hidden');
        document.getElementById('pegawai-init-box').classList.remove('hidden');
    }
}

function renderPegawaiTable() {
    const tbody = document.getElementById('pegawai-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchInput = document.getElementById('search-pegawai');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    const filterJabatanSelect = document.getElementById('filter-jabatan-pegawai');
    const filterJabatan = filterJabatanSelect ? filterJabatanSelect.value : '';

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
        statJabatanList.innerHTML = Object.keys(jabatanCounts).map(jab => `
            <div class="flex justify-between items-center py-0.5 border-b border-slate-100">
                <span class="font-medium text-slate-600">${jab}:</span>
                <span class="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">${jabatanCounts[jab]}</span>
            </div>
        `).join('');
    }

    const statPokjaList = document.getElementById('stat-pokja-list');
    if (statPokjaList) {
        statPokjaList.innerHTML = Object.keys(pokjaCounts).map(pok => `
            <div class="flex justify-between items-center py-0.5 border-b border-slate-100">
                <span class="font-medium text-slate-600">${pok}:</span>
                <span class="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">${pokjaCounts[pok]}</span>
            </div>
        `).join('');
    }

    const filteredPegawai = dataPegawai.filter(peg => {
        const nama = peg.nama ? peg.nama.toLowerCase() : '';
        const nip = peg.nip ? peg.nip.toLowerCase() : '';
        const jabatan = peg.jabatan ? peg.jabatan.toLowerCase() : '';
        const pokja = peg.pokja ? peg.pokja.toLowerCase() : '';
        const createdAccount = peg.createdByAccount ? peg.createdByAccount.toLowerCase() : '';

        const matchSearch = nama.includes(search) || nip.includes(search) || jabatan.includes(search) || pokja.includes(search) || createdAccount.includes(search);
        const matchJabatan = filterJabatan ? peg.jabatan === filterJabatan : true;

        return matchSearch && matchJabatan;
    });

    const countFilteredEl = document.getElementById('total-filtered-pegawai');
    if (countFilteredEl) countFilteredEl.innerText = filteredPegawai.length;

    if (filteredPegawai.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 italic font-medium">Data pegawai tidak ditemukan.</td></tr>`;
        updateDropdownOptions();
        return;
    }

    filteredPegawai.forEach(peg => {
        const isEditable = canUserModify(peg.createdByAccount);
        const linkedAccountName = peg.createdByAccount || 'admin';

        let detailBadge = '';
        if (peg.vokasional) {
            detailBadge += `<br><span class="text-[11px] text-indigo-700 font-bold mt-0.5 inline-block"><i class="fa-solid fa-graduation-cap mr-1"></i> ${peg.vokasional}</span>`;
        }
        if (peg.asrama) {
            detailBadge += `<br><span class="text-[11px] text-amber-700 font-bold mt-0.5 inline-block"><i class="fa-solid fa-house-chimney mr-1"></i> Pengasuh: ${peg.asrama}</span>`;
        }

        const tr = document.createElement('tr');
        tr.className = "transition border-b border-slate-100 hover:bg-indigo-50/75 cursor-pointer";
        
        tr.onclick = (e) => {
            if (!e.target.closest('button')) {
                openViewPegawaiModal(peg.id);
            }
        };

        tr.innerHTML = `
            <td class="p-3.5">
                ${peg.foto && peg.foto.trim() !== '' ? `<img src="${peg.foto}" class="w-12 h-12 rounded-xl object-cover border border-slate-200 shadow-sm">` : `<div class="w-12 h-12 bg-indigo-50 text-indigo-700 rounded-xl flex items-center justify-center text-xs font-extrabold border border-indigo-200 shadow-sm">${peg.nama ? peg.nama.charAt(0) : 'P'}</div>`}
            </td>
            <td class="p-3.5 font-bold text-slate-900">${peg.nama}</td>
            <td class="p-3.5 text-slate-600 font-mono text-xs font-semibold">${peg.nip}</td>
            <td class="p-3.5">
                <span class="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">${peg.jabatan}</span>
                ${detailBadge}
            </td>
            <td class="p-3.5 text-slate-700 font-medium">${peg.pokja}</td>
            <td class="p-3.5">
                <span class="px-2.5 py-1 bg-slate-100 text-indigo-600 rounded-full text-xs font-mono font-bold">
                    <i class="fa-solid fa-link mr-1"></i> ${linkedAccountName}
                </span>
            </td>
            <td class="p-3.5 text-center">
                <div class="flex items-center justify-center space-x-2">
                    ${isEditable ? `
                        <button onclick="editPegawai('${peg.id}')" class="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition shadow-sm" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="deletePegawai('${peg.id}')" class="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition shadow-sm" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                    ` : `<span class="text-[11px] text-slate-400 font-medium bg-slate-100 px-2.5 py-1 rounded-lg"><i class="fa-solid fa-lock mr-1"></i> Locked</span>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    updateDropdownOptions();
}

function renderPerkembanganTable() {
    const tbody = document.getElementById('perkembangan-table-body');
    if(!tbody) return;
    const filterPM = document.getElementById('filter-perkembangan-pm').value;
    tbody.innerHTML = '';

    let filtered = filterPM ? dataPerkembangan.filter(p => p.pmId === filterPM) : dataPerkembangan;

    if (currentUser && currentUser.role !== 'admin') {
        const myPegawai = dataPegawai.find(p => p.id === currentUser.pegawaiId || p.createdByAccount === currentUser.username);
        if (myPegawai) {
            if (myPegawai.jabatan === 'Instruktur') {
                filtered = filtered.filter(p => p.kategori === 'Vokasional');
            } else if (myPegawai.jabatan === 'Pengasuh') {
                filtered = filtered.filter(p => p.kategori === 'Perilaku & Disiplin');
            } else if (myPegawai.jabatan === 'Petugas Keamanan') {
                filtered = filtered.filter(p => p.kategori === 'Perilaku & Disiplin');
            } else if (myPegawai.jabatan === 'Pekerja Sosial') {
                filtered = filtered.filter(p => p.kategori !== 'Vokasional');
            }
        }
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-10 text-center text-slate-400 italic font-medium">
                    <i class="fa-solid fa-folder-open text-3xl mb-2 block text-slate-300"></i>
                    Belum ada catatan rekam perkembangan.
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(p => {
        const pm = dataPM.find(item => item.id === p.pmId) || { nama: 'PM Terhapus' };
        
        const petugasObj = dataPegawai.find(peg => peg.nama === p.petugas || `${peg.nama} (${peg.jabatan})` === p.petugas);
        const isKeamananRecord = petugasObj && petugasObj.jabatan === 'Petugas Keamanan';

        const isEditable = canUserModify(p.createdByAccount);
        const tr = document.createElement('tr');
        tr.className = "hover:bg-indigo-50/40 transition border-b border-slate-100";
        tr.innerHTML = `
            <td class="p-3.5 font-mono text-xs text-slate-600 font-medium">${formatDateWithTime(p.tanggal)}</td>
            <td class="p-3.5 font-bold text-slate-900">${pm.nama}</td>
            <td class="p-3.5">
                <span class="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-bold">${p.kategori}</span>
                ${isKeamananRecord ? `<br><span class="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded-full text-[10px] font-extrabold shadow-sm"><i class="fa-solid fa-shield-halved"></i> Petugas Keamanan</span>` : ''}
            </td>
            <td class="p-3.5 text-slate-700 max-w-xs font-medium leading-relaxed">
                ${p.deskripsi}
                ${p.foto ? `<div class="mt-2"><img src="${p.foto}" class="max-w-[120px] max-h-[120px] rounded-lg object-cover border border-slate-200 shadow-sm"></div>` : ''}
            </td>
            <td class="p-3.5 text-slate-600 max-w-xs font-medium">${p.rekomendasi || '-'}</td>
            <td class="p-3.5 text-slate-700 font-semibold">${p.petugas}</td>
            <td class="p-3.5 text-[11px] font-mono text-slate-500 font-semibold">${p.createdByAccount || '-'}</td>
            <td class="p-3.5 text-center">
                <div class="flex items-center justify-center space-x-2">
                    ${isEditable ? `
                        <button onclick="editPerkembangan('${p.id}')" class="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition shadow-sm" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="deletePerkembangan('${p.id}')" class="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition shadow-sm" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                    ` : `<span class="text-[11px] text-slate-400 font-medium bg-slate-100 px-2 py-1 rounded-lg"><i class="fa-solid fa-lock mr-1"></i> Locked</span>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- KATEGORI PERKEMBANGAN TERMASUK PENILAIAN ASRAMA BULANAN UNTUK PENGASUH ---
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
        const jabatan = petugasObj.jabatan;

        if (jabatan === 'Instruktur') {
            optionsHtml = `<option value="Vokasional" selected>Vokasional</option>`;
            if (petugasObj.vokasional) {
                filteredPMList = dataPM.filter(pm => pm.vokasional === petugasObj.vokasional);
            }
        } else if (jabatan === 'Pengasuh') {
            optionsHtml = `
                <option value="Perilaku & Disiplin" selected>Perilaku & Disiplin</option>
                <option value="Penilaian Asrama Bulanan">Penilaian Asrama Bulanan</option>
            `;
            if (petugasObj.asrama) {
                filteredPMList = dataPM.filter(pm => pm.asrama === petugasObj.asrama);
            }
        } else if (jabatan === 'Petugas Keamanan') {
            optionsHtml = `<option value="Perilaku & Disiplin" selected>Perilaku & Disiplin</option>`;
        } else if (jabatan === 'Dokter' || jabatan === 'Perawat' || jabatan === 'Fisioterapi') {
            optionsHtml = `<option value="Kesehatan Fisik & Medis" selected>Kesehatan Fisik & Medis</option>`;
        } else if (jabatan === 'Psikolog') {
            optionsHtml = `<option value="Kesehatan Mental & Psikologis" selected>Kesehatan Mental & Psikologis</option>`;
        } else if (jabatan === 'Pekerja Sosial' || jabatan === 'Ketua Pokja') {
            optionsHtml = `
                <option value="Perilaku & Disiplin">Perilaku & Disiplin</option>
                <option value="Penilaian Asrama Bulanan">Penilaian Asrama Bulanan</option>
                <option value="Kesehatan Mental & Psikologis">Kesehatan Mental & Psikologis</option>
                <option value="Kesehatan Fisik & Medis">Kesehatan Fisik & Medis</option>
                <option value="Keagamaan & Kerohanian">Keagamaan & Kerohanian</option>
                <option value="Interaksi Sosial">Interaksi Sosial</option>
                <option value="Keterampilan">Keterampilan</option>
                <option value="Vokasional">Vokasional</option>
            `;
        } else {
            optionsHtml = `
                <option value="Perilaku & Disiplin">Perilaku & Disiplin</option>
                <option value="Penilaian Asrama Bulanan">Penilaian Asrama Bulanan</option>
                <option value="Interaksi Sosial">Interaksi Sosial</option>
                <option value="Keterampilan">Keterampilan</option>
            `;
        }
    } else {
        optionsHtml = `
            <option value="Perilaku & Disiplin">Perilaku & Disiplin</option>
            <option value="Penilaian Asrama Bulanan">Penilaian Asrama Bulanan</option>
            <option value="Kesehatan Mental & Psikologis">Kesehatan Mental & Psikologis</option>
            <option value="Kesehatan Fisik & Medis">Kesehatan Fisik & Medis</option>
        `;
    }

    selectKategori.innerHTML = optionsHtml;
    if (currentKategoriVal && Array.from(selectKategori.options).some(opt => opt.value === currentKategoriVal)) {
        selectKategori.value = currentKategoriVal;
    }

    if (selectPM) {
        const currentPMVal = selectPM.value;
        selectPM.innerHTML = filteredPMList.map(p => `<option value="${p.id}">${p.nama} - (${p.kasus})</option>`).join('');
        if (currentPMVal && Array.from(selectPM.options).some(opt => opt.value === currentPMVal)) {
            selectPM.value = currentPMVal;
        }
    }
}

function updateDropdownOptions() {
    const peksosSelect = document.getElementById('pm-peksos');
    const filterPerkembangan = document.getElementById('filter-perkembangan-pm');
    const perkPMSelect = document.getElementById('perkembangan-pm');
    const perkPetugasSelect = document.getElementById('perkembangan-petugas');

    if(!peksosSelect) return;

    const peksosList = dataPegawai.filter(p => p.jabatan === 'Pekerja Sosial' || p.jabatan === 'Ketua Pokja');
    peksosSelect.innerHTML = peksosList.map(p => `<option value="${p.nama}">${p.nama}</option>`).join('');

    if (currentUser) {
        if (currentUser.role === 'admin') {
            const currentSelectedPetugas = perkPetugasSelect.value;
            perkPetugasSelect.innerHTML = dataPegawai.map(p => `<option value="${p.nama}">${p.nama} (${p.jabatan})</option>`).join('');
            perkPetugasSelect.removeAttribute("disabled");

            if (currentSelectedPetugas && Array.from(perkPetugasSelect.options).some(opt => opt.value === currentSelectedPetugas)) {
                perkPetugasSelect.value = currentSelectedPetugas;
            }
        } else {
            const myPegawai = dataPegawai.find(p => p.id === currentUser.pegawaiId || p.createdByAccount === currentUser.username);
            
            if (myPegawai) {
                perkPetugasSelect.innerHTML = `<option value="${myPegawai.nama}" selected>${myPegawai.nama} (${myPegawai.jabatan})</option>`;
                perkPetugasSelect.setAttribute("disabled", "true");
            } else {
                perkPetugasSelect.innerHTML = `<option value="${currentUser.username}">${currentUser.username}</option>`;
                perkPetugasSelect.setAttribute("disabled", "true");
            }
        }
    }

    updatePerkembanganKategoriOptions();

    const currentFilterPMVal = filterPerkembangan ? filterPerkembangan.value : "";
    const currentPerkPMVal = perkPMSelect ? perkPMSelect.value : "";

    const pmOptions = dataPM.map(p => `<option value="${p.id}">${p.nama} - (${p.kasus})</option>`).join('');
    
    if (filterPerkembangan) {
        filterPerkembangan.innerHTML = `<option value="">-- Semua PM --</option>` + pmOptions;
        if (currentFilterPMVal && Array.from(filterPerkembangan.options).some(opt => opt.value === currentFilterPMVal)) {
            filterPerkembangan.value = currentFilterPMVal;
        }
    }

    if (perkPMSelect) {
        perkPMSelect.innerHTML = pmOptions;
        if (currentPerkPMVal && Array.from(perkPMSelect.options).some(opt => opt.value === currentPerkPMVal)) {
            perkPMSelect.value = currentPerkPMVal;
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
    const id = document.getElementById('pm-id').value || 'PM' + String(Date.now()).slice(-4);
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
            if (tipeAsrama === 'Rumah Antara') {
                lokasiAsrama = 'Rumah Antara';
            } else {
                lokasiAsrama = document.getElementById('pm-nama-asrama-select').value;
            }
        }

        const newPM = {
            id: id,
            nama: document.getElementById('pm-nama').value.trim(),
            ibu: document.getElementById('pm-ibu').value.trim(),
            jk: document.getElementById('pm-jk').value,
            kasus: document.getElementById('pm-kasus').value,
            vokasional: document.getElementById('pm-vokasional').value,
            asrama: lokasiAsrama,
            status: document.getElementById('pm-status').value,
            peksos: document.getElementById('pm-peksos').value,
            masuk: document.getElementById('pm-masuk').value,
            terminasi: terminasiVal,
            foto: fotoBase64 || (existingIndex >= 0 ? dataPM[existingIndex].foto : ''),
            createdByAccount: owner
        };

        if(existingIndex >= 0) {
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
    const id = document.getElementById('pegawai-id').value || 'PEG' + String(Date.now()).slice(-4);
    const fotoInput = document.getElementById('pegawai-foto');
    const existingIndex = dataPegawai.findIndex(p => p.id === id);

    if (!fotoInput.files || !fotoInput.files[0]) {
        if (existingIndex < 0 || !dataPegawai[existingIndex].foto) {
            alert('Foto pegawai wajib diunggah!');
            return;
        }
    }

    const handleSave = (fotoBase64) => {
        let owner = currentUser ? currentUser.username : 'admin';
        if (existingIndex >= 0) {
            const oldOwner = dataPegawai[existingIndex].createdByAccount;
            owner = oldOwner || currentUser.username;
        }

        const jabatanVal = document.getElementById('pegawai-jabatan').value;
        const isPengasuhChecked = document.querySelector('input[name="modal-is-pengasuh"]:checked').value === 'ya';

        const newPegawai = {
            id: id,
            nama: document.getElementById('pegawai-nama').value,
            nip: document.getElementById('pegawai-nip').value,
            jabatan: jabatanVal,
            pokja: document.getElementById('pegawai-pokja').value,
            vokasional: jabatanVal === 'Instruktur' ? document.getElementById('pegawai-vokasional').value : '',
            asrama: isPengasuhChecked ? document.getElementById('pegawai-asrama').value : '',
            foto: fotoBase64 || (existingIndex >= 0 ? dataPegawai[existingIndex].foto : ''),
            createdByAccount: owner
        };

        if(existingIndex >= 0) {
            if (!canUserModify(dataPegawai[existingIndex].createdByAccount)) {
                alert('Akses ditolak! Anda hanya dapat mengubah data pegawai yang dibuat oleh akun Anda sendiri.');
                return;
            }
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
    const id = document.getElementById('perkembangan-id').value || 'PER' + String(Date.now()).slice(-4);
    const fotoInput = document.getElementById('perkembangan-foto');
    const selectPetugas = document.getElementById('perkembangan-petugas');
    const selectedNamaPetugas = selectPetugas ? selectPetugas.value : '';

    const petugasObj = dataPegawai.find(p => p.nama === selectedNamaPetugas || `${p.nama} (${p.jabatan})` === selectedNamaPetugas);
    const isPetugasKeamanan = petugasObj && petugasObj.jabatan === 'Petugas Keamanan';

    const existingIndex = dataPerkembangan.findIndex(p => p.id === id);
    const hasExistingFoto = existingIndex >= 0 && dataPerkembangan[existingIndex].foto;

    if (isPetugasKeamanan && (!fotoInput.files || !fotoInput.files[0]) && !hasExistingFoto) {
        alert('Validasi Gagal: Petugas Keamanan wajib mengunggah foto dokumentasi bukti rekam perkembangan / kejadian!');
        return;
    }

    const handleSave = (fotoBase64) => {
        const owner = existingIndex >= 0 ? dataPerkembangan[existingIndex].createdByAccount : (currentUser ? currentUser.username : 'admin');

        const newRecord = {
            id: id,
            pmId: document.getElementById('perkembangan-pm').value,
            tanggal: document.getElementById('perkembangan-tanggal').value,
            kategori: document.getElementById('perkembangan-kategori').value,
            deskripsi: document.getElementById('perkembangan-deskripsi').value,
            rekomendasi: document.getElementById('perkembangan-rekomendasi').value,
            petugas: document.getElementById('perkembangan-petugas').value,
            foto: fotoBase64 || (existingIndex >= 0 ? dataPerkembangan[existingIndex].foto : ''),
            createdByAccount: owner
        };

        if(existingIndex >= 0) {
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

function deletePM(id) {
    const item = dataPM.find(p => p.id === id);
    if (!item || !canUserModify(item.createdByAccount)) {
        alert('Anda tidak memiliki hak akses untuk menghapus data ini.');
        return;
    }
    if(confirm('Hapus data PM ini? Semua rekam perkembangan terkait juga akan terhapus.')) {
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

function deletePegawai(id) {
    const item = dataPegawai.find(p => p.id === id);
    if (!item) {
        alert('Data pegawai tidak ditemukan.');
        return;
    }

    if (!canUserModify(item.createdByAccount)) {
        alert('Akses ditolak! Anda hanya dapat menghapus data pegawai yang dibuat oleh akun Anda sendiri.');
        return;
    }

    if(confirm('Apakah Anda yakin ingin menghapus data pegawai ini?')) {
        dataPegawai = dataPegawai.filter(p => p.id !== id);
        
        Object.keys(usersDB).forEach(username => {
            if (usersDB[username].pegawaiId === id) {
                usersDB[username].pegawaiId = null;
            }
        });

        saveData();
        renderPegawaiTable();
        addSystemLog('Hapus Pegawai', `Pegawai ${item.nama} dihapus.`);
        showToast('Data pegawai berhasil dihapus.');
    }
}

function deletePerkembangan(id) {
    const item = dataPerkembangan.find(p => p.id === id);
    if (!item || !canUserModify(item.createdByAccount)) {
        alert('Anda tidak memiliki hak akses untuk menghapus data ini.');
        return;
    }
    if(confirm('Hapus catatan perkembangan ini?')) {
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

    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
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

    const myPegawai = dataPegawai.find(p => p.id === currentUser.pegawaiId || p.createdByAccount === currentUser.username);
    
    let optionsHtml = `<option value="individu">Form Terkini per PM (Hanya Data Saya)</option>`;

    if (myPegawai) {
        if (myPegawai.jabatan === 'Instruktur' || myPegawai.vokasional) {
            optionsHtml += `<option value="vokasional">Laporan Penilaian Vokasional (${myPegawai.vokasional || 'Bidang'})</option>`;
        }
        if (myPegawai.asrama) {
            optionsHtml += `<option value="asrama">Laporan Penilaian Asrama (${myPegawai.asrama})</option>`;
        }
        if (myPegawai.jabatan === 'Pekerja Sosial' || myPegawai.jabatan === 'Ketua Pokja') {
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
    updateDropdownOptions();

    if(editId) {
        const pm = dataPM.find(p => p.id === editId);
        if(pm) {
            document.getElementById('pm-id').value = pm.id;
            document.getElementById('pm-nama').value = pm.nama;
            document.getElementById('pm-ibu').value = pm.ibu;
            document.getElementById('pm-jk').value = pm.jk;
            document.getElementById('pm-kasus').value = pm.kasus;
            if(pm.vokasional) document.getElementById('pm-vokasional').value = pm.vokasional;
            
            if (pm.asrama) {
                document.querySelector('input[name="pm-is-residensial"][value="ya"]').checked = true;
                togglePMResidensialOption(true);
                if (pm.asrama === 'Rumah Antara') {
                    document.getElementById('pm-asrama').value = 'Rumah Antara';
                    togglePMAsramaCustomSelect();
                } else {
                    document.getElementById('pm-asrama').value = 'Asrama Residensial';
                    togglePMAsramaCustomSelect();
                    document.getElementById('pm-nama-asrama-select').value = pm.asrama;
                }
            }

            document.getElementById('pm-status').value = pm.status;
            document.getElementById('pm-peksos').value = pm.peksos;
            document.getElementById('pm-masuk').value = pm.masuk;
            document.getElementById('pm-terminasi').value = pm.terminasi;
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
    document.getElementById('pegawai-foto').setAttribute('required', 'true');
    document.getElementById('modal-wrapper-vokasional').classList.add('hidden');
    document.getElementById('modal-wrapper-asrama').classList.add('hidden');
    document.querySelector('input[name="modal-is-pengasuh"][value="tidak"]').checked = true;

    if(editId) {
        const peg = dataPegawai.find(p => p.id === editId);
        if(peg) {
            document.getElementById('pegawai-id').value = peg.id;
            document.getElementById('pegawai-nama').value = peg.nama;
            document.getElementById('pegawai-nip').value = peg.nip;
            document.getElementById('pegawai-jabatan').value = peg.jabatan;
            document.getElementById('pegawai-pokja').value = peg.pokja;
            
            toggleModalConditionalFields();
            if (peg.vokasional) {
                document.getElementById('pegawai-vokasional').value = peg.vokasional;
            }

            if (peg.asrama) {
                document.querySelector('input[name="modal-is-pengasuh"][value="ya"]').checked = true;
                toggleModalAsramaOption(true);
                document.getElementById('pegawai-asrama').value = peg.asrama;
            }

            if (peg.foto) {
                document.getElementById('pegawai-foto').removeAttribute('required');
            }
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
    updateDropdownOptions();

    if(editId) {
        const perk = dataPerkembangan.find(p => p.id === editId);
        if(perk) {
            document.getElementById('perkembangan-id').value = perk.id;
            document.getElementById('perkembangan-pm').value = perk.pmId;
            if (perk.tanggal) {
                const d = new Date(perk.tanggal);
                if (!isNaN(d.getTime())) {
                    const isoLocal = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                    document.getElementById('perkembangan-tanggal').value = isoLocal;
                } else {
                    document.getElementById('perkembangan-tanggal').value = perk.tanggal;
                }
            }
            
            document.getElementById('perkembangan-petugas').value = perk.petugas;
            updatePerkembanganKategoriOptions();
            document.getElementById('perkembangan-kategori').value = perk.kategori;
            document.getElementById('perkembangan-deskripsi').value = perk.deskripsi;
            document.getElementById('perkembangan-rekomendasi').value = perk.rekomendasi;
            document.getElementById('modal-perkembangan-title').innerText = 'Edit Rekam Perkembangan';
        }
    } else {
        const now = new Date();
        const isoLocalNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        document.getElementById('perkembangan-tanggal').value = isoLocalNow;
    }
    document.getElementById('modal-perkembangan').classList.remove('hidden');
}

function closePerkembanganModal() { document.getElementById('modal-perkembangan').classList.add('hidden'); }
function editPerkembangan(id) { openPerkembanganModal(id); }

function compressImage(file, callback) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function(event) {
        const img = new Image();
        img.src = event.target.result;
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1000;
            const MAX_HEIGHT = 1000;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            } else {
                if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.9));
        };
    };
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

    if (currentUser && currentUser.role !== 'admin') {
        const myPegawai = dataPegawai.find(p => p.id === currentUser.pegawaiId || p.createdByAccount === currentUser.username);
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
        const filteredPM = dataPM.filter(pm => pm.peksos === selectedPeksos);
        document.getElementById('report-rekap-title').innerText = "LAPORAN REKAPITULASI PM BERDASARKAN PEKSOS PENDAMPING";
        document.getElementById('report-rekap-subtitle').innerText = `Pekerja Sosial Pendamping: ${selectedPeksos}`;
        ttdKananLabel.innerText = "Pekerja Sosial Pendamping";

        const peksosObj = dataPegawai.find(p => p.nama === selectedPeksos);
        document.getElementById('report-ttd-peksos-nama').innerText = selectedPeksos;
        document.getElementById('report-ttd-peksos-nip').innerText = peksosObj ? peksosObj.nip : '-';
        renderFilteredTable(filteredPM);
    } else if (type === 'kasus') {
        const selectedKasus = document.getElementById('select-laporan-kasus').value;
        const filteredPM = dataPM.filter(pm => pm.kasus === selectedKasus);
        document.getElementById('report-rekap-title').innerText = "LAPORAN REKAPITULASI PM BERDASARKAN KATEGORI KASUS";
        document.getElementById('report-rekap-subtitle').innerText = `Kategori Kasus: ${selectedKasus}`;
        ttdKananLabel.innerText = "Pekerja Sosial Pendamping";

        document.getElementById('report-ttd-peksos-nama').innerText = "Pekerja Sosial Pendamping";
        document.getElementById('report-ttd-peksos-nip').innerText = "-";
        renderFilteredTable(filteredPM);
    } else if (type === 'vokasional') {
        const selectedVok = document.getElementById('select-laporan-vokasional').value;
        const filteredPM = dataPM.filter(pm => pm.vokasional === selectedVok);
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
        const filteredPM = dataPM.filter(pm => pm.asrama === selectedAsrama);
        document.getElementById('report-detail-title').innerText = "LAPORAN HASIL PENILAIAN PERKEMBANGAN PM BERDASARKAN NAMA ASRAMA";
        document.getElementById('report-detail-subtitle').innerText = `Penempatan Residensial: ${selectedAsrama}`;
        ttdKananLabel.innerText = "Pengasuh Asrama Residensial";

        const pengasuhObj = dataPegawai.find(p => p.asrama === selectedAsrama);
        if (pengasuhObj) {
            document.getElementById('report-ttd-peksos-nama').innerText = pengasuhObj.nama;
            document.getElementById('report-ttd-peksos-nip').innerText = pengasuhObj.nip;
        } else {
            document.getElementById('report-ttd-peksos-nama').innerText = `Pengasuh ${selectedAsrama}`;
            document.getElementById('report-ttd-peksos-nip').innerText = "-";
        }
        renderDetailPerkembanganTable(filteredPM, 'Perilaku & Disiplin');
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
                    <h5 class="font-bold text-sm text-slate-900">${pm.nama}</h5>
                    <p class="text-[11px] text-slate-500">Ibu Kandung: ${pm.ibu} | Kasus: ${pm.kasus}</p>
                </div>
                <div class="text-right text-[11px]">
                    <span class="font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full">${pm.vokasional || '-'}</span>
                    <span class="font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full ml-1">${pm.asrama || 'Non-Residensial'}</span>
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
                        <td class="border border-slate-300 p-2 font-semibold align-top">${p.kategori}</td>
                        <td class="border border-slate-300 p-2 align-top">
                            <p>${p.deskripsi}</p>
                            ${p.rekomendasi ? `<p class="mt-1 text-slate-600 italic"><strong>Rekomendasi:</strong> ${p.rekomendasi}</p>` : ''}
                            ${p.foto ? `<div class="mt-2"><img src="${p.foto}" alt="Foto Perkembangan" class="max-w-[150px] max-h-[150px] object-cover rounded border shadow-sm"></div>` : ''}
                        </td>
                        <td class="border border-slate-300 p-2 align-top font-medium">${p.petugas}</td>
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

    let targetDataPM = dataPM;

    if (currentUser && currentUser.role !== 'admin') {
        targetDataPM = dataPM.filter(pm => pm.createdByAccount === currentUser.username);
        document.getElementById('report-rekap-title').innerText = "LAPORAN REKAPITULASI DATA PM (PRIBADI PETUGAS)";
        document.getElementById('report-rekap-subtitle').innerText = `Daftar PM yang Ditambahkan oleh Akun: ${currentUser.username}`;
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
            <td class="border border-slate-300 p-2 font-bold">${pm.nama}<br><span class="text-slate-500 text-[10px]">Ibu: ${pm.ibu}</span></td>
            <td class="border border-slate-300 p-2">${pm.kasus}</td>
            <td class="border border-slate-300 p-2">${pm.status}</td>
            <td class="border border-slate-300 p-2">${pm.peksos}</td>
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

function populateLaporanSelect() {
    const selectPM = document.getElementById('select-laporan-pm');
    
    let targetPMList = dataPM;
    if (currentUser && currentUser.role !== 'admin') {
        targetPMList = dataPM.filter(p => p.createdByAccount === currentUser.username);
    }
    
    selectPM.innerHTML = targetPMList.map(pm => `<option value="${pm.id}">${pm.nama} (${pm.kasus})</option>`).join('');

    const selectPeksos = document.getElementById('select-laporan-peksos');
    const peksosList = dataPegawai.filter(p => p.jabatan === 'Pekerja Sosial' || p.jabatan === 'Ketua Pokja');
    selectPeksos.innerHTML = peksosList.map(p => `<option value="${p.nama}">${p.nama}</option>`).join('');
}

function generateReport() {
    const pmId = document.getElementById('select-laporan-pm').value;
    const pm = dataPM.find(p => p.id === pmId);
    if(!pm) return;

    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('report-print-date').innerText = todayStr;
    document.getElementById('report-ttd-date').innerText = todayStr;
    document.getElementById('report-ttd-kanan-label').innerText = "Pekerja Sosial Pendamping";

    document.getElementById('report-pm-nama').innerText = pm.nama;
    document.getElementById('report-pm-ibu').innerText = pm.ibu;
    document.getElementById('report-pm-jk').innerText = pm.jk;
    document.getElementById('report-pm-kasus').innerText = pm.kasus;
    document.getElementById('report-pm-vokasional').innerText = pm.vokasional || '-';
    document.getElementById('report-pm-asrama').innerText = pm.asrama || 'Tidak Ada (Non-Residensial)';
    document.getElementById('report-pm-status').innerText = pm.status;
    document.getElementById('report-pm-peksos').innerText = pm.peksos;
    document.getElementById('report-pm-masuk').innerText = formatDateOnly(pm.masuk);
    document.getElementById('report-pm-terminasi').innerText = pm.terminasi ? formatDateOnly(pm.terminasi) : 'Belum Ditentukan';

    const imgEl = document.getElementById('report-pm-photo');
    const iconEl = document.getElementById('report-pm-photo-icon');
    if(pm.foto) {
        imgEl.src = pm.foto;
        imgEl.classList.remove('hidden');
        iconEl.classList.add('hidden');
    } else {
        imgEl.classList.add('hidden');
        iconEl.classList.remove('hidden');
    }

    const peksosObj = dataPegawai.find(p => p.nama === pm.peksos);
    document.getElementById('report-ttd-peksos-nama').innerText = pm.peksos || 'Pekerja Sosial Pendamping';
    document.getElementById('report-ttd-peksos-nip').innerText = peksosObj ? peksosObj.nip : '-';

    const KetuaPokjaObj = dataPegawai.find(p => p.jabatan === 'Ketua Pokja');
    if(KetuaPokjaObj) {
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
    pmPerkembangan.sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));

    const reportTbody = document.getElementById('report-perkembangan-body');
    reportTbody.innerHTML = '';

    if(pmPerkembangan.length === 0) {
        reportTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">Belum ada catatan rekam perkembangan yang diinput oleh akun Anda.</td></tr>`;
    } else {
        pmPerkembangan.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="border border-slate-300 p-2 font-mono align-top">${formatDateWithTime(p.tanggal)}</td>
                <td class="border border-slate-300 p-2 font-semibold align-top">${p.kategori}</td>
                <td class="border border-slate-300 p-2 align-top">
                    <p>${p.deskripsi}</p>
                    ${p.rekomendasi ? `<p class="mt-1 text-slate-600 italic"><strong>Rekomendasi:</strong> ${p.rekomendasi}</p>` : ''}
                    ${p.foto ? `<div class="mt-2"><img src="${p.foto}" alt="Foto Perkembangan" class="max-w-[150px] max-h-[150px] object-cover rounded border shadow-sm"></div>` : ''}
                </td>
                <td class="border border-slate-300 p-2 align-top">${p.petugas}</td>
            `;
            reportTbody.appendChild(tr);
        });
    }
}

function formatDate(dateString) { return formatDateOnly(dateString); }

function formatDateOnly(dateString) {
    if (!dateString) return '-';
    const dateObj = new Date(dateString);
    if (isNaN(dateObj.getTime())) return dateString;

    const day = String(dateObj.getDate()).padStart(2, '0');
    const monthNames = [
        '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const month = monthNames[dateObj.getMonth() + 1];
    const year = dateObj.getFullYear();

    return `${day} ${month} ${year}`;
}

function formatDateWithTime(dateString) {
    if (!dateString) return '-';
    const dateObj = new Date(dateString);
    if (isNaN(dateObj.getTime())) return dateString;

    const day = String(dateObj.getDate()).padStart(2, '0');
    const monthNames = [
        '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const month = monthNames[dateObj.getMonth() + 1];
    const year = dateObj.getFullYear();

    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');

    return `${day} ${month} ${year}, ${hours}:${minutes}`;
}