import { useEffect, useState } from 'react';
import {
  Download,
  Edit3,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type { AdminRole, AdminUser } from '../../types/evoting';
import {
  buildAdminQrDownloadFilename,
  generateAdminQrDataUrl,
  renderAdminQrCardPngDataUrl,
} from '../../utils/adminQr';
import { ensureAdminQrTokens, generateAdminQrToken, generateId } from '../../utils/electionLogic';

interface StaffManagerProps {
  admins: AdminUser[];
  currentAdminId: string;
  schoolName?: string;
  electionTitle?: string;
  onSaveAdmins: (nextAdmins: AdminUser[], action: string, detail: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export function StaffManager({
  admins,
  currentAdminId,
  schoolName = 'SMAN 1 Kabun',
  electionTitle = 'Pemilihan Ketua & Wakil Ketua OSIS',
  onSaveAdmins,
  onNotify,
}: StaffManagerProps) {
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [role, setRole] = useState<AdminRole>('ADMIN');
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [qrPreviewAdmin, setQrPreviewAdmin] = useState<AdminUser | null>(null);
  const [qrPreviewDataUrl, setQrPreviewDataUrl] = useState<string>('');
  const [downloadingQrId, setDownloadingQrId] = useState<string | null>(null);
  const [isRotatingQr, setIsRotatingQr] = useState(false);

  const ensureAdminHasQrToken = (target: AdminUser): AdminUser => {
    if (target.qrToken && target.qrToken.trim().length > 0) {
      return target;
    }
    const { admins: normalizedAdmins } = ensureAdminQrTokens(admins);
    const matched = normalizedAdmins.find((item) => item.id === target.id) || {
      ...target,
      qrToken: generateAdminQrToken(),
    };
    onSaveAdmins(
      normalizedAdmins,
      'INIT_ADMIN_QR',
      `Mengaktifkan token QR Login untuk akun pengelola ${matched.fullName} (@${matched.username}).`
    );
    return matched;
  };

  useEffect(() => {
    if (!qrPreviewAdmin) {
      setQrPreviewDataUrl('');
      return;
    }
    let cancelled = false;
    void generateAdminQrDataUrl(qrPreviewAdmin).then((url) => {
      if (!cancelled) {
        setQrPreviewDataUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [qrPreviewAdmin]);

  const triggerDownloadDataUrl = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleOpenQrModal = (admin: AdminUser) => {
    const readyAdmin = ensureAdminHasQrToken(admin);
    setQrPreviewAdmin(readyAdmin);
  };

  const handleDownloadAdminQr = async (admin: AdminUser) => {
    if (downloadingQrId) return;
    setDownloadingQrId(admin.id);
    try {
      const readyAdmin = ensureAdminHasQrToken(admin);
      const cardDataUrl = await renderAdminQrCardPngDataUrl(
        readyAdmin,
        schoolName,
        electionTitle
      );
      const filename = buildAdminQrDownloadFilename(readyAdmin);
      triggerDownloadDataUrl(cardDataUrl, filename);
      onNotify(
        'success',
        'QR Login Panitia Diunduh',
        `Kartu QR untuk ${readyAdmin.fullName} (${readyAdmin.role}) disimpan sebagai ${filename}.`
      );
    } catch {
      onNotify('error', 'Gagal Mengunduh QR', 'Terjadi kesalahan saat membuat gambar Kartu QR Panitia.');
    } finally {
      setDownloadingQrId(null);
    }
  };

  const handleRotateQrToken = () => {
    if (!qrPreviewAdmin || isRotatingQr) return;
    setIsRotatingQr(true);
    const nextToken = generateAdminQrToken();
    const updatedAdmin: AdminUser = {
      ...qrPreviewAdmin,
      qrToken: nextToken,
    };
    const nextAdmins = admins.map((a) => (a.id === updatedAdmin.id ? updatedAdmin : a));
    onSaveAdmins(
      nextAdmins,
      'ROTATE_ADMIN_QR',
      `Membuat ulang kode QR Login untuk ${updatedAdmin.fullName} (@${updatedAdmin.username}).`
    );
    setQrPreviewAdmin(updatedAdmin);
    setIsRotatingQr(false);
    onNotify(
      'success',
      'QR Login Diperbarui',
      `Kode QR lama untuk @${updatedAdmin.username} dinonaktifkan. Unduh kartu QR baru sekarang.`
    );
  };

  const openAddModal = () => {
    setEditingAdmin(null);
    setUsername('');
    setFullName('');
    setPassword('');
    setWhatsappNumber('');
    setRole('ADMIN');
    setShowFormModal(true);
  };

  const openEditModal = (admin: AdminUser) => {
    setEditingAdmin(admin);
    setUsername(admin.username);
    setFullName(admin.fullName);
    setPassword(admin.password);
    setWhatsappNumber(admin.whatsappNumber || '');
    setRole(admin.role);
    setShowFormModal(true);
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const u = username.trim();
    const fn = fullName.trim();
    const wa = whatsappNumber.trim();
    const waDigits = wa.replace(/\D/g, '');
    if (!u || !fn || password.length < 4) {
      onNotify(
        'error',
        'Data Akun Tidak Valid',
        'Username, nama lengkap, dan kata sandi (min. 4 karakter) wajib diisi.'
      );
      return;
    }
    if (waDigits.length < 9) {
      onNotify(
        'error',
        'Nomor WhatsApp Tidak Valid',
        'Masukkan nomor WhatsApp aktif (minimal 9 digit) untuk konfirmasi lupa kata sandi.'
      );
      return;
    }

    const duplicateUsername = admins.some(
      (a) => a.username.toLowerCase() === u.toLowerCase() && a.id !== editingAdmin?.id
    );
    if (duplicateUsername) {
      onNotify('error', 'Username Sudah Terdaftar', `Username "${u}" sudah digunakan.`);
      return;
    }

    if (editingAdmin) {
      const superCount = admins.filter((a) => a.role === 'SUPERADMIN').length;
      if (editingAdmin.role === 'SUPERADMIN' && role !== 'SUPERADMIN' && superCount <= 1) {
        onNotify(
          'error',
          'Tidak Diizinkan',
          'Sistem harus memiliki minimal satu akun dengan peran SuperAdmin.'
        );
        return;
      }

      setIsSaving(true);
      window.setTimeout(() => {
        const nextAdmins = admins.map((a) =>
          a.id === editingAdmin.id
            ? {
                ...a,
                username: u,
                fullName: fn,
                password,
                whatsappNumber: wa,
                role,
                qrToken: a.qrToken?.trim() || generateAdminQrToken(),
              }
            : a
        );

        onSaveAdmins(
          nextAdmins,
          'UPDATE_ADMIN',
          `Memperbarui akun pengelola ${fn} (@${u}, ${role}).`
        );
        setIsSaving(false);
        setShowFormModal(false);
        onNotify('success', 'Akun Diperbarui', `Perubahan pada akun ${fn} berhasil disimpan.`);
      }, 350);
      return;
    }

    setIsSaving(true);
    window.setTimeout(() => {
      const created: AdminUser = {
        id: generateId('adm'),
        username: u,
        password,
        fullName: fn,
        whatsappNumber: wa,
        role,
        qrToken: generateAdminQrToken(),
        createdAt: new Date().toISOString(),
      };

      onSaveAdmins(
        [...admins, created],
        'ADD_ADMIN',
        `Menambahkan akun ${role}: ${fn} (@${u}).`
      );
      setIsSaving(false);
      setShowFormModal(false);
      onNotify('success', 'Akun Panitia Dibuat', `Akun ${fn} (${role}) siap digunakan.`);
    }, 350);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget || isDeleting) return;
    if (deleteTarget.id === currentAdminId) {
      onNotify('error', 'Tidak Diizinkan', 'Anda tidak dapat menghapus akun yang sedang aktif.');
      setDeleteTarget(null);
      return;
    }

    const superCount = admins.filter((a) => a.role === 'SUPERADMIN').length;
    if (deleteTarget.role === 'SUPERADMIN' && superCount <= 1) {
      onNotify('error', 'Tidak Diizinkan', 'Sistem harus memiliki minimal satu SuperAdmin.');
      setDeleteTarget(null);
      return;
    }

    setIsDeleting(true);
    const target = deleteTarget;
    window.setTimeout(() => {
      const next = admins.filter((a) => a.id !== target.id);
      onSaveAdmins(
        next,
        'DELETE_ADMIN',
        `Menghapus akun pengelola ${target.fullName} (@${target.username}).`
      );
      onNotify('info', 'Akun Dihapus', `Akun ${target.fullName} telah dihapus.`);
      setIsDeleting(false);
      setDeleteTarget(null);
    }, 350);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">Manajemen Akun Panitia</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Kelola akun SuperAdmin &amp; Admin serta unduh Kartu QR Login Panitia untuk masuk cepat
            tanpa perlu mengganti kata sandi saat lupa password.
          </p>
        </div>
        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-sm font-bold cursor-pointer whitespace-nowrap"
        >
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          <span>Tambah Akun Panitia</span>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600">
                <th className="py-3.5 px-4">Nama Lengkap</th>
                <th className="py-3.5 px-4">Username</th>
                <th className="py-3.5 px-4">Nomor WhatsApp</th>
                <th className="py-3.5 px-4">Tingkat Peran</th>
                <th className="py-3.5 px-4">QR Login</th>
                <th className="py-3.5 px-4">Dibuat Pada</th>
                <th className="py-3.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {admins.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-4 font-semibold text-slate-900">
                    {a.fullName}
                    {a.id === currentAdminId && (
                      <span className="ml-2 text-xs font-normal text-slate-500">(Anda)</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-700">{a.username}</td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-700">
                    {a.whatsappNumber || <span className="text-slate-400">Belum diisi</span>}
                  </td>
                  <td className="py-3.5 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                        a.role === 'SUPERADMIN' ? 'text-amber-700' : 'text-[#1E3A5F]'
                      }`}
                    >
                      <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{a.role}</span>
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid={`download-admin-qr-${a.username}`}
                        disabled={downloadingQrId === a.id}
                        onClick={() => void handleDownloadAdminQr(a)}
                        aria-label={`Unduh QR Login ${a.fullName}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
                      >
                        {downloadingQrId === a.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--app-secondary)]" aria-hidden="true" />
                        ) : (
                          <Download className="w-3.5 h-3.5 text-[var(--app-secondary)]" aria-hidden="true" />
                        )}
                        <span>Unduh QR</span>
                      </button>
                      <button
                        type="button"
                        data-testid={`view-admin-qr-${a.username}`}
                        onClick={() => handleOpenQrModal(a)}
                        aria-label={`Lihat QR Login ${a.fullName}`}
                        title="Lihat & Buat Ulang QR Login"
                        className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer"
                      >
                        <QrCode className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-500 tabular-nums">
                    {new Date(a.createdAt).toLocaleDateString('id-ID')}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(a)}
                        aria-label={`Edit akun ${a.fullName}`}
                        className="p-2 rounded-lg text-slate-500 hover:text-[#1E3A5F] hover:bg-slate-100 cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={a.id === currentAdminId}
                        onClick={() => setDeleteTarget(a)}
                        aria-label={`Hapus akun ${a.fullName}`}
                        className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showFormModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 id="staff-modal-title" className="text-base font-extrabold text-slate-900">
                {editingAdmin ? 'Ubah Data Akun Pengelola' : 'Tambah Akun Panitia Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                aria-label="Tutup modal akun"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-6 space-y-4">
              <div>
                <label htmlFor="adm-fullname" className="block text-xs font-bold text-slate-700 mb-1">
                  Nama Lengkap / Jabatan
                </label>
                <input
                  id="adm-fullname"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Budi Hartono (Seksi Verifikasi)"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label htmlFor="adm-username" className="block text-xs font-bold text-slate-700 mb-1">
                  Username Login
                </label>
                <input
                  id="adm-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="panitia2"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono text-sm"
                />
              </div>

              <div>
                <label htmlFor="adm-wa" className="block text-xs font-bold text-slate-700 mb-1">
                  Nomor WhatsApp (Untuk Konfirmasi Lupa Kata Sandi)
                </label>
                <input
                  id="adm-wa"
                  type="tel"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  placeholder="Contoh: 081234567890"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono text-sm"
                />
              </div>

              <div>
                <label htmlFor="adm-pass" className="block text-xs font-bold text-slate-700 mb-1">
                  Kata Sandi
                </label>
                <input
                  id="adm-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 4 karakter"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label htmlFor="adm-role" className="block text-xs font-bold text-slate-700 mb-1">
                  Peran (Role)
                </label>
                <select
                  id="adm-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as AdminRole)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="ADMIN">Admin (Panitia DPT &amp; Ringkasan)</option>
                  <option value="SUPERADMIN">SuperAdmin (Akses Penuh)</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setShowFormModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white text-xs font-bold cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      <span>Menyimpan Akun...</span>
                    </>
                  ) : editingAdmin ? (
                    <span>Simpan Perubahan</span>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Simpan Akun</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-adm-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-xl">
            <h3 id="del-adm-title" className="text-lg font-extrabold text-slate-900">
              Hapus Akun Panitia?
            </h3>
            <p className="text-sm text-slate-600 mt-2">
              Akun <strong>{deleteTarget.fullName}</strong> ({deleteTarget.username}) tidak akan
              bisa mengakses Panel Admin lagi.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-75 text-white text-xs font-bold cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <span>Hapus Akun</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {qrPreviewAdmin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-adm-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-[var(--app-primary)] text-white">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
                <h3 id="qr-adm-title" className="text-base font-extrabold">
                  Kartu QR Login Panitia
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQrPreviewAdmin(null)}
                aria-label="Tutup modal QR Login Panitia"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-center">
                <p className="text-base font-extrabold text-slate-900">{qrPreviewAdmin.fullName}</p>
                <p className="text-xs font-mono font-bold text-[var(--app-secondary)] mt-0.5">
                  {qrPreviewAdmin.role} · @{qrPreviewAdmin.username}
                </p>
              </div>

              <div className="flex items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                {qrPreviewDataUrl ? (
                  <img
                    src={qrPreviewDataUrl}
                    alt={`QR Login ${qrPreviewAdmin.fullName}`}
                    className="w-56 h-56 object-contain bg-white p-2 rounded-xl border border-slate-200"
                  />
                ) : (
                  <div className="w-56 h-56 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" aria-hidden="true" />
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-600 text-center leading-relaxed">
                Gunakan QR ini pada tab <strong>Scan QR Panitia</strong> di halaman Login Admin
                untuk masuk langsung tanpa mengetik ulang kata sandi saat lupa password. Simpan di
                tempat aman dan jangan dibagikan ke pemilih.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  data-testid="modal-rotate-admin-qr-btn"
                  disabled={isRotatingQr}
                  onClick={handleRotateQrToken}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 text-xs font-bold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                  <span>Buat Ulang QR</span>
                </button>
                <button
                  type="button"
                  data-testid="modal-download-admin-qr-btn"
                  disabled={downloadingQrId === qrPreviewAdmin.id}
                  onClick={() => void handleDownloadAdminQr(qrPreviewAdmin)}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {downloadingQrId === qrPreviewAdmin.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>Unduh Kartu QR (PNG)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
