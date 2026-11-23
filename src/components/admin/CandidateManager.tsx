import { useRef, useState } from 'react';
import { Edit3, ImagePlus, Loader2, Plus, Trash2, X } from 'lucide-react';
import type { Candidate } from '../../types/evoting';
import { generateId } from '../../utils/electionLogic';
import { CandidateImage } from '../CandidateImage';

interface CandidateManagerProps {
  candidates: Candidate[];
  onSaveCandidates: (nextCandidates: Candidate[], action: string, detail: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

const PRESET_PORTRAITS = [
  { label: 'Foto Studio 1', url: '/src/assets/images/paslon_01_portrait_1794869429956.jpg' },
  { label: 'Foto Studio 2', url: '/src/assets/images/paslon_02_portrait_1794869430302.jpg' },
  { label: 'Foto Studio 3', url: '/src/assets/images/paslon_03_portrait_1794869432146.jpg' },
];

function resizeCandidatePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file foto.'));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('Format gambar tidak valid.'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
      img.onload = () => {
        const maxDim = 720;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

const DEFAULT_CANDIDATE_COLORS = ['#059669', '#D97706', '#1E3A5F', '#0284C7', '#7C3AED', '#DC2626'];

export function CandidateManager({
  candidates,
  onSaveCandidates,
  onNotify,
}: CandidateManagerProps) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Candidate | null>(null);

  const [nomorUrut, setNomorUrut] = useState('1');
  const [ketuaName, setKetuaName] = useState('');
  const [ketuaClass, setKetuaClass] = useState('');
  const [wakilName, setWakilName] = useState('');
  const [wakilClass, setWakilClass] = useState('');
  const [photoUrl, setPhotoUrl] = useState(PRESET_PORTRAITS[0].url);
  const [vision, setVision] = useState('');
  const [missionsText, setMissionsText] = useState('');
  const [accentColor, setAccentColor] = useState('#059669');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const sorted = [...candidates].sort((a, b) => a.nomorUrut - b.nomorUrut);

  const openAdd = () => {
    const nextNum = sorted.length > 0 ? Math.max(...sorted.map((c) => c.nomorUrut)) + 1 : 1;
    setEditing(null);
    setNomorUrut(String(nextNum));
    setKetuaName('');
    setKetuaClass('');
    setWakilName('');
    setWakilClass('');
    setPhotoUrl(PRESET_PORTRAITS[(nextNum - 1) % PRESET_PORTRAITS.length].url);
    setVision('');
    setMissionsText('');
    setAccentColor(DEFAULT_CANDIDATE_COLORS[(nextNum - 1) % DEFAULT_CANDIDATE_COLORS.length]);
    setShowModal(true);
  };

  const openEdit = (c: Candidate) => {
    setEditing(c);
    setNomorUrut(String(c.nomorUrut));
    setKetuaName(c.ketuaName);
    setKetuaClass(c.ketuaClass);
    setWakilName(c.wakilName);
    setWakilClass(c.wakilClass);
    setPhotoUrl(c.photoUrl);
    setVision(c.vision);
    setMissionsText(c.missions.join('\n'));
    setAccentColor(c.accentColor);
    setShowModal(true);
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onNotify('error', 'Format Tidak Didukung', 'Pilih file gambar (JPG, PNG, WebP).');
      e.target.value = '';
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const resized = await resizeCandidatePhoto(file);
      setPhotoUrl(resized);
      onNotify('info', 'Foto Paslon Dimuat', `Foto "${file.name}" siap disimpan.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses foto paslon.';
      onNotify('error', 'Gagal Memuat Foto', msg);
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const num = Number(nomorUrut);
    if (!Number.isInteger(num) || num < 1) {
      onNotify('error', 'Nomor Urut Tidak Valid', 'Masukkan nomor urut angka bulat positif.');
      return;
    }
    if (!ketuaName.trim() || !wakilName.trim() || !vision.trim()) {
      onNotify(
        'error',
        'Data Paslon Belum Lengkap',
        'Nama Ketua, Nama Wakil, dan Visi wajib diisi.'
      );
      return;
    }

    const missions = missionsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    setIsSaving(true);
    window.setTimeout(() => {
      if (editing) {
        const next = candidates.map((c) =>
          c.id === editing.id
            ? {
                ...c,
                nomorUrut: num,
                ketuaName: ketuaName.trim(),
                ketuaClass: ketuaClass.trim() || 'XI',
                wakilName: wakilName.trim(),
                wakilClass: wakilClass.trim() || 'X',
                photoUrl: photoUrl.trim(),
                vision: vision.trim(),
                missions: missions.length > 0 ? missions : ['Meningkatkan prestasi siswa'],
                programs: [],
                accentColor,
              }
            : c
        );
        onSaveCandidates(
          next,
          'UPDATE_CANDIDATE',
          `Memperbarui data Paslon 0${num}: ${ketuaName.trim()} & ${wakilName.trim()}.`
        );
        onNotify('success', 'Paslon Diperbarui', `Data Paslon 0${num} berhasil disimpan.`);
      } else {
        const created: Candidate = {
          id: generateId('paslon'),
          nomorUrut: num,
          ketuaName: ketuaName.trim(),
          ketuaClass: ketuaClass.trim() || 'XI',
          wakilName: wakilName.trim(),
          wakilClass: wakilClass.trim() || 'X',
          photoUrl: photoUrl.trim(),
          vision: vision.trim(),
          missions: missions.length > 0 ? missions : ['Meningkatkan prestasi siswa'],
          programs: [],
          votes: 0,
          accentColor,
        };
        onSaveCandidates(
          [...candidates, created],
          'ADD_CANDIDATE',
          `Menambahkan Paslon 0${num}: ${created.ketuaName} & ${created.wakilName}.`
        );
        onNotify('success', 'Paslon Ditambahkan', `Paslon 0${num} siap dipilih di bilik suara.`);
      }
      setIsSaving(false);
      setShowModal(false);
    }, 350);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    const target = deleteTarget;
    window.setTimeout(() => {
      const next = candidates.filter((c) => c.id !== target.id);
      onSaveCandidates(
        next,
        'DELETE_CANDIDATE',
        `Menghapus Paslon 0${target.nomorUrut}: ${target.ketuaName} & ${target.wakilName}.`
      );
      onNotify('info', 'Paslon Dihapus', `Paslon 0${target.nomorUrut} telah dihapus.`);
      setIsDeleting(false);
      setDeleteTarget(null);
    }, 350);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">
            Manajemen Pasangan Calon (Kandidat OSIS)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Khusus SuperAdmin: Tambah, ubah profil, foto, visi, serta misi Paslon.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-sm font-bold cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Tambah Paslon</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {sorted.map((c) => (
          <article
            key={c.id}
            className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between"
          >
            <div>
              <div className="relative aspect-[4/3] bg-slate-100">
                <CandidateImage
                  src={c.photoUrl}
                  alt={`Paslon ${c.nomorUrut}`}
                  nomorUrut={c.nomorUrut}
                  className="w-full h-full"
                />
                <div className="absolute top-3 left-3 bg-[#0F1E3D] text-white px-3 py-1 rounded-lg font-mono text-xs font-bold">
                  Paslon 0{c.nomorUrut}
                </div>
                <div className="absolute top-3 right-3 bg-white/95 text-slate-900 px-3 py-1 rounded-lg font-mono text-xs font-bold border border-slate-200 tabular-nums">
                  {c.votes} suara
                </div>
              </div>

              <div className="p-5 space-y-2">
                <div>
                  <p className="text-[11px] font-semibold text-slate-500">Ketua · {c.ketuaClass}</p>
                  <h3 className="text-base font-extrabold text-slate-900">{c.ketuaName}</h3>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-500">Wakil · {c.wakilClass}</p>
                  <p className="text-sm font-bold text-slate-800">{c.wakilName}</p>
                </div>
                <p className="text-xs text-slate-600 pt-2 border-t border-slate-100 line-clamp-2">
                  {c.vision}
                </p>
              </div>
            </div>

            <div className="px-5 pb-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => openEdit(c)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Edit Paslon</span>
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(c)}
                aria-label={`Hapus Paslon 0${c.nomorUrut}`}
                className="p-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cand-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 id="cand-modal-title" className="text-base font-extrabold text-slate-900">
                {editing ? `Edit Paslon 0${editing.nomorUrut}` : 'Tambah Pasangan Calon Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Tutup modal kandidat"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="cand-num" className="block text-xs font-bold text-slate-700 mb-1">
                    Nomor Urut
                  </label>
                  <input
                    id="cand-num"
                    type="number"
                    min={1}
                    value={nomorUrut}
                    onChange={(e) => setNomorUrut(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cand-color" className="block text-xs font-bold text-slate-700 mb-1">
                    Warna Grafik Monitor
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="cand-color"
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-10 w-14 rounded-lg border border-slate-300 cursor-pointer"
                    />
                    <span className="font-mono text-xs text-slate-600">{accentColor}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cand-ketua" className="block text-xs font-bold text-slate-700 mb-1">
                    Nama Calon Ketua
                  </label>
                  <input
                    id="cand-ketua"
                    type="text"
                    value={ketuaName}
                    onChange={(e) => setKetuaName(e.target.value)}
                    placeholder="Nama calon ketua"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="cand-ketua-cls" className="block text-xs font-bold text-slate-700 mb-1">
                    Kelas Calon Ketua
                  </label>
                  <input
                    id="cand-ketua-cls"
                    type="text"
                    value={ketuaClass}
                    onChange={(e) => setKetuaClass(e.target.value)}
                    placeholder="XI MIPA 1"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cand-wakil" className="block text-xs font-bold text-slate-700 mb-1">
                    Nama Calon Wakil Ketua
                  </label>
                  <input
                    id="cand-wakil"
                    type="text"
                    value={wakilName}
                    onChange={(e) => setWakilName(e.target.value)}
                    placeholder="Nama calon wakil"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="cand-wakil-cls" className="block text-xs font-bold text-slate-700 mb-1">
                    Kelas Calon Wakil
                  </label>
                  <input
                    id="cand-wakil-cls"
                    type="text"
                    value={wakilClass}
                    onChange={(e) => setWakilClass(e.target.value)}
                    placeholder="X Merdeka 3"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              {/* Foto Paslon from Device Storage + URL/Presets */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  Foto Paslon (Ambil dari Penyimpanan Perangkat atau URL)
                </label>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3.5">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-white border border-slate-200 shrink-0">
                    <CandidateImage
                      src={photoUrl}
                      alt="Pratinjau Foto Paslon"
                      nomorUrut={Number(nomorUrut) || 1}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="flex-1 space-y-2 min-w-0">
                    <input
                      ref={photoInputRef}
                      id="cand-photo-file"
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoFileChange}
                      className="hidden"
                    />

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isUploadingPhoto}
                        onClick={() => photoInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-70 text-white text-xs font-bold cursor-pointer"
                      >
                        {isUploadingPhoto ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            <span>Memuat Foto...</span>
                          </>
                        ) : (
                          <>
                            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Pilih Foto dari Perangkat</span>
                          </>
                        )}
                      </button>

                      {PRESET_PORTRAITS.map((preset) => (
                        <button
                          key={preset.url}
                          type="button"
                          onClick={() => setPhotoUrl(preset.url)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <input
                      id="cand-photo"
                      type="text"
                      aria-label="URL atau Data URI Foto Paslon"
                      value={photoUrl}
                      onChange={(e) => setPhotoUrl(e.target.value)}
                      placeholder="/src/assets/images/..."
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="cand-vision" className="block text-xs font-bold text-slate-700 mb-1">
                  Visi Pasangan Calon
                </label>
                <textarea
                  id="cand-vision"
                  rows={2}
                  value={vision}
                  onChange={(e) => setVision(e.target.value)}
                  placeholder="Tuliskan visi utama..."
                  className="w-full p-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label htmlFor="cand-missions" className="block text-xs font-bold text-slate-700 mb-1">
                  Misi Pasangan Calon (1 baris per poin)
                </label>
                <textarea
                  id="cand-missions"
                  rows={4}
                  value={missionsText}
                  onChange={(e) => setMissionsText(e.target.value)}
                  placeholder={'Misi pertama\nMisi kedua'}
                  className="w-full p-3 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setShowModal(false)}
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
                      <span>Menyimpan Paslon...</span>
                    </>
                  ) : (
                    <span>Simpan Paslon</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-cand-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-xl">
            <h3 id="del-cand-title" className="text-lg font-extrabold text-slate-900">
              Hapus Paslon 0{deleteTarget.nomorUrut}?
            </h3>
            <p className="text-sm text-slate-600 mt-2">
              Pasangan <strong>{deleteTarget.ketuaName} &amp; {deleteTarget.wakilName}</strong> akan
              dihapus dari daftar surat suara.
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
                  <span>Hapus Paslon</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
