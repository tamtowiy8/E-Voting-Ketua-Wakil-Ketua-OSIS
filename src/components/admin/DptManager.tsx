import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  Printer,
  QrCode,
  Search,
  Trash2,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { Candidate, ElectionSettings, GradeLevel, Voter } from '../../types/evoting';
import {
  DPT_DISPLAY_LIMIT,
  MAX_CSV_VOTERS,
  compareAdditionalVoters,
  compareStudentVotersByClass,
  deleteVotersByIds,
  exportVotersCsv,
  extractGrade,
  getVoterDocIdFromNis,
  generateSixDigitToken,
  isAdditionalVoter,
  mergeDptbCsvVoters,
  parseDptbVotersCsv,
  parseVotersCsv,
  sortVotersOrdered,
  type VoterEditPayload,
} from '../../utils/electionLogic';
import {
  downloadVoterCardsPdf,
  generateVoterQrDataUrl,
} from '../../utils/voterCardPdf';

interface DptManagerProps {
  voters: Voter[];
  candidates: Candidate[];
  settings: ElectionSettings;
  isSuperAdmin: boolean;
  onSaveVoters: (nextVoters: Voter[], auditAction: string, auditDetail: string) => void;
  onImportCsvVoters?: (importedVoters: Voter[], skippedCount: number, warnings: string[]) => Promise<void> | void;
  onEditVoter: (voterId: string, payload: VoterEditPayload) => boolean;
  onOpenGoogleSheets?: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export function DptManager({
  voters,
  candidates,
  settings,
  isSuperAdmin,
  onSaveVoters,
  onImportCsvVoters,
  onEditVoter,
  onOpenGoogleSheets,
  onNotify,
}: DptManagerProps) {
  const [activeSubMenu, setActiveSubMenu] = useState<'DPT' | 'DPTB'>('DPT');

  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<'ALL' | GradeLevel>('ALL');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'VOTED' | 'NOT_VOTED'>('ALL');
  const [displayLimit, setDisplayLimit] = useState<number>(DPT_DISPLAY_LIMIT);

  // DPTb (Daftar Pemilih Tambahan) search, filter & pagination state
  const [dptbSearchQuery, setDptbSearchQuery] = useState('');
  const [dptbCategoryFilter, setDptbCategoryFilter] = useState<string>('ALL');
  const [dptbStatusFilter, setDptbStatusFilter] = useState<'ALL' | 'VOTED' | 'NOT_VOTED'>('ALL');
  const [dptbDisplayLimit, setDptbDisplayLimit] = useState<number>(DPT_DISPLAY_LIMIT);

  // Add / Edit modal
  const [showFormModal, setShowFormModal] = useState(false);
  const [formMode, setFormMode] = useState<'DPT' | 'DPTB'>('DPT');
  const [editingVoter, setEditingVoter] = useState<Voter | null>(null);
  const [formNis, setFormNis] = useState('');
  const [formName, setFormName] = useState('');
  const [formKelas, setFormKelas] = useState('');
  const [formHasVoted, setFormHasVoted] = useState(false);
  const [formVotedCandidateId, setFormVotedCandidateId] = useState('');

  // Import CSV modal (DPT Siswa)
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvText, setCsvText] = useState(
    'NIS,Nama,Kelas\n2024101,Raka Pratama,X Merdeka 1\n2024102,Intan Permata,XI MIPA 2'
  );

  // Import CSV modal (DPTb)
  const [showDptbImportModal, setShowDptbImportModal] = useState(false);
  const [dptbCsvText, setDptbCsvText] = useState(
    'ID,Nama,Keterangan\n2026101,Drs. H. Ahmad Hidayat M.Pd.,Kepala Sekolah\n2026102,Siti Nurhaliza S.Pd.,Guru\n2026103,Bambang Sutrisno,TENDIK'
  );

  // Delete confirmation modals
  const [deleteTarget, setDeleteTarget] = useState<Voter | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedDptbIds, setSelectedDptbIds] = useState<Set<string>>(new Set());
  const [bulkDeleteScope, setBulkDeleteScope] = useState<'DPT' | 'DPTB' | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const selectAllDptbRef = useRef<HTMLInputElement | null>(null);

  // Loading states
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPrintingCards, setIsPrintingCards] = useState(false);

  // Single voter QR preview modal
  const [qrPreviewVoter, setQrPreviewVoter] = useState<Voter | null>(null);
  const [qrPreviewDataUrl, setQrPreviewDataUrl] = useState<string>('');

  // Sorted Student DPT (X A -> XII E) & Sorted Additional DPTb (Kepala Sekolah -> Guru -> Tendik -> Lainnya)
  const studentVoters = useMemo(
    () => voters.filter((v) => !isAdditionalVoter(v)).sort(compareStudentVotersByClass),
    [voters]
  );

  const additionalVoters = useMemo(
    () => voters.filter((v) => isAdditionalVoter(v)).sort(compareAdditionalVoters),
    [voters]
  );

  const availableStudentClasses = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    studentVoters.forEach((v) => {
      if (gradeFilter !== 'ALL' && v.grade !== gradeFilter) return;
      const cls = v.kelas.trim();
      if (cls && !seen.has(cls)) {
        seen.add(cls);
        list.push(cls);
      }
    });
    return list;
  }, [studentVoters, gradeFilter]);

  useEffect(() => {
    if (classFilter !== 'ALL' && !availableStudentClasses.includes(classFilter)) {
      setClassFilter('ALL');
    }
  }, [classFilter, availableStudentClasses]);

  const availableDptbCategories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    additionalVoters.forEach((v) => {
      const ket = v.kelas.trim();
      if (ket && !seen.has(ket)) {
        seen.add(ket);
        list.push(ket);
      }
    });
    return list;
  }, [additionalVoters]);

  useEffect(() => {
    if (dptbCategoryFilter !== 'ALL' && !availableDptbCategories.includes(dptbCategoryFilter)) {
      setDptbCategoryFilter('ALL');
    }
  }, [dptbCategoryFilter, availableDptbCategories]);

  const filteredVoters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return studentVoters.filter((v) => {
      const matchQuery =
        !q ||
        v.nis.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.kelas.toLowerCase().includes(q);
      const matchGrade = gradeFilter === 'ALL' || v.grade === gradeFilter;
      const matchClass = classFilter === 'ALL' || v.kelas.trim() === classFilter;
      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'VOTED' && v.hasVoted) ||
        (statusFilter === 'NOT_VOTED' && !v.hasVoted);
      return matchQuery && matchGrade && matchClass && matchStatus;
    });
  }, [studentVoters, searchQuery, gradeFilter, classFilter, statusFilter]);

  const displayedVoters = useMemo(
    () => filteredVoters.slice(0, displayLimit),
    [filteredVoters, displayLimit]
  );

  const filteredAdditionalVoters = useMemo(() => {
    const q = dptbSearchQuery.trim().toLowerCase();
    return additionalVoters.filter((v) => {
      const matchQuery =
        !q ||
        v.nis.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.kelas.toLowerCase().includes(q);
      const matchCategory =
        dptbCategoryFilter === 'ALL' || v.kelas.trim() === dptbCategoryFilter;
      const matchStatus =
        dptbStatusFilter === 'ALL' ||
        (dptbStatusFilter === 'VOTED' && v.hasVoted) ||
        (dptbStatusFilter === 'NOT_VOTED' && !v.hasVoted);
      return matchQuery && matchCategory && matchStatus;
    });
  }, [additionalVoters, dptbSearchQuery, dptbCategoryFilter, dptbStatusFilter]);

  const displayedAdditionalVoters = useMemo(
    () => filteredAdditionalVoters.slice(0, dptbDisplayLimit),
    [filteredAdditionalVoters, dptbDisplayLimit]
  );

  useEffect(() => {
    setDisplayLimit(DPT_DISPLAY_LIMIT);
  }, [searchQuery, gradeFilter, classFilter, statusFilter]);

  useEffect(() => {
    setDptbDisplayLimit(DPT_DISPLAY_LIMIT);
  }, [dptbSearchQuery, dptbCategoryFilter, dptbStatusFilter]);

  const allVisibleSelected =
    displayedVoters.length > 0 && displayedVoters.every((v) => selectedIds.has(v.id));
  const someVisibleSelected =
    displayedVoters.some((v) => selectedIds.has(v.id)) && !allVisibleSelected;

  const allVisibleDptbSelected =
    displayedAdditionalVoters.length > 0 &&
    displayedAdditionalVoters.every((v) => selectedDptbIds.has(v.id));
  const someVisibleDptbSelected =
    displayedAdditionalVoters.some((v) => selectedDptbIds.has(v.id)) && !allVisibleDptbSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    if (selectAllDptbRef.current) {
      selectAllDptbRef.current.indeterminate = someVisibleDptbSelected;
    }
  }, [someVisibleDptbSelected]);

  // Keep selectedIds & selectedDptbIds synced if voters change externally
  useEffect(() => {
    const studentIdSet = new Set(studentVoters.map((v) => v.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (studentIdSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    const dptbIdSet = new Set(additionalVoters.map((v) => v.id));
    setSelectedDptbIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (dptbIdSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [studentVoters, additionalVoters]);

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        displayedVoters.forEach((v) => next.delete(v.id));
      } else {
        displayedVoters.forEach((v) => next.add(v.id));
      }
      return next;
    });
  };

  const toggleSelectOneDptb = (id: string) => {
    setSelectedDptbIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAllVisibleDptb = () => {
    setSelectedDptbIds((prev) => {
      const next = new Set(prev);
      if (allVisibleDptbSelected) {
        displayedAdditionalVoters.forEach((v) => next.delete(v.id));
      } else {
        displayedAdditionalVoters.forEach((v) => next.add(v.id));
      }
      return next;
    });
  };

  const activeBulkSelectionSet =
    bulkDeleteScope === 'DPTB' ? selectedDptbIds : selectedIds;

  const handleConfirmBulkDelete = () => {
    const count = activeBulkSelectionSet.size;
    if (count === 0 || isDeleting || !bulkDeleteScope) return;
    setIsDeleting(true);
    const idsCopy = new Set(activeBulkSelectionSet);
    const scope = bulkDeleteScope;
    window.setTimeout(() => {
      const nextVoters = deleteVotersByIds(voters, idsCopy);
      onSaveVoters(
        nextVoters,
        'BULK_DELETE_VOTERS',
        `Menghapus ${count} data pemilih terpilih secara massal dari ${scope === 'DPTB' ? 'DPTb' : 'DPT'}.`
      );
      if (scope === 'DPTB') {
        setSelectedDptbIds(new Set());
      } else {
        setSelectedIds(new Set());
      }
      setIsDeleting(false);
      setBulkDeleteScope(null);
      onNotify(
        'info',
        scope === 'DPTB' ? 'Data DPTb Dihapus' : 'Data DPT Dihapus',
        `${count} pemilih terpilih telah dihapus dari ${scope === 'DPTB' ? 'DPTb' : 'DPT'}.`
      );
    }, 350);
  };

  const sortedCandidates = useMemo(
    () => [...candidates].sort((a, b) => a.nomorUrut - b.nomorUrut),
    [candidates]
  );

  const selectedChosenCandidate = useMemo(
    () => sortedCandidates.find((c) => c.id === formVotedCandidateId) || null,
    [sortedCandidates, formVotedCandidateId]
  );

  const openAddModal = (mode: 'DPT' | 'DPTB' = 'DPT') => {
    setFormMode(mode);
    setEditingVoter(null);
    setFormNis('');
    setFormName('');
    setFormKelas(mode === 'DPTB' ? 'Guru' : '');
    setFormHasVoted(false);
    setFormVotedCandidateId('');
    setShowFormModal(true);
  };

  const openEditModal = (v: Voter) => {
    setFormMode(isAdditionalVoter(v) ? 'DPTB' : 'DPT');
    setEditingVoter(v);
    setFormNis(v.nis);
    setFormName(v.name);
    setFormKelas(v.kelas);
    setFormHasVoted(v.hasVoted);
    setFormVotedCandidateId(v.votedCandidateId || '');
    setShowFormModal(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const nis = formNis.trim();
    const name = formName.trim();
    const kelas = formKelas.trim();
    const isDptb = formMode === 'DPTB';

    if (!nis || !name || !kelas) {
      onNotify(
        'error',
        'Data Tidak Lengkap',
        isDptb
          ? 'ID, Nama Lengkap, dan Keterangan wajib diisi.'
          : 'NIS/NISN, Nama Lengkap, dan Kelas wajib diisi.'
      );
      return;
    }

    if (isDptb && !isAdditionalVoter({ kelas })) {
      onNotify(
        'error',
        'Keterangan DPTb Tidak Sesuai',
        'Gunakan keterangan selain kelas siswa (contoh: Kepala Sekolah, Guru, TENDIK).'
      );
      return;
    }

    const duplicateNis = voters.some((v) => v.nis === nis && v.id !== editingVoter?.id);
    if (duplicateNis) {
      onNotify(
        'error',
        isDptb ? 'ID Duplikat' : 'NIS/NISN Duplikat',
        `${isDptb ? 'ID' : 'NIS/NISN'} ${nis} sudah terdaftar di daftar pemilih.`
      );
      return;
    }

    setIsSaving(true);
    window.setTimeout(() => {
      let savedOk = true;
      if (editingVoter) {
        savedOk = onEditVoter(editingVoter.id, {
          nis,
          name,
          kelas,
          hasVoted: formHasVoted,
          votedCandidateId:
            isSuperAdmin && formHasVoted ? formVotedCandidateId || undefined : undefined,
        });
        if (savedOk) {
          onNotify(
            'success',
            isDptb ? 'Data DPTb Diperbarui' : 'Pemilih Diperbarui',
            `Data ${name} berhasil disimpan.`
          );
        }
      } else {
        const newVoter: Voter = {
          id: getVoterDocIdFromNis(nis),
          nis,
          name,
          kelas,
          grade: extractGrade(kelas),
          token: generateSixDigitToken(new Set(voters.map((v) => v.token))),
          hasVoted: formHasVoted,
          votedAt: formHasVoted ? new Date().toISOString() : undefined,
        };
        onSaveVoters(
          [newVoter, ...voters],
          'ADD_VOTER',
          isDptb
            ? `Menambahkan pemilih tambahan (DPTb) ${name} (ID ${nis}, Keterangan ${kelas}).`
            : `Menambahkan pemilih baru ${name} (NIS/NISN ${nis}, Kelas ${kelas}).`
        );
        onNotify(
          'success',
          isDptb ? 'DPTb Ditambahkan' : 'Pemilih Ditambahkan',
          `${name} berhasil ditambahkan ke ${isDptb ? 'Daftar Pemilih Tambahan (DPTb)' : 'DPT'}.`
        );
      }
      setIsSaving(false);
      if (savedOk) {
        setShowFormModal(false);
      }
    }, 150);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    const target = deleteTarget;
    const isDptbTarget = isAdditionalVoter(target);
    window.setTimeout(() => {
      const nextVoters = voters.filter((v) => v.id !== target.id);
      onSaveVoters(
        nextVoters,
        'DELETE_VOTER',
        isDptbTarget
          ? `Menghapus pemilih tambahan ${target.name} (ID ${target.nis}) dari DPTb.`
          : `Menghapus pemilih ${target.name} (NIS/NISN ${target.nis}) dari DPT.`
      );
      onNotify(
        'info',
        isDptbTarget ? 'DPTb Dihapus' : 'Pemilih Dihapus',
        `${target.name} dihapus dari ${isDptbTarget ? 'DPTb' : 'DPT'}.`
      );
      setIsDeleting(false);
      setDeleteTarget(null);
    }, 350);
  };

  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const { added, skippedCount, errors } = parseVotersCsv(
      csvText,
      new Set(),
      new Set(),
      MAX_CSV_VOTERS
    );

    if (added.length === 0) {
      onNotify(
        'error',
        'Import CSV Gagal',
        errors[0] || 'Tidak ada baris pemilih baru yang valid untuk diimpor.'
      );
      return;
    }

    setIsSaving(true);
    try {
      setSearchQuery('');
      setGradeFilter('ALL');
      setClassFilter('ALL');
      setStatusFilter('ALL');
      setDisplayLimit(DPT_DISPLAY_LIMIT);
      setDptbSearchQuery('');
      setDptbCategoryFilter('ALL');
      setDptbStatusFilter('ALL');
      setDptbDisplayLimit(DPT_DISPLAY_LIMIT);

      const orderedImported = sortVotersOrdered(added);
      if (onImportCsvVoters) {
        await onImportCsvVoters(orderedImported, skippedCount, errors);
      } else {
        onSaveVoters(
          orderedImported,
          'IMPORT_DPT_CSV',
          `Mengimpor ${orderedImported.length} pemilih dari CSV (${skippedCount} duplikat dilewati).`
        );
      }
      setShowImportModal(false);
      onNotify(
        'success',
        'Import CSV Berhasil',
        `${orderedImported.length} pemilih siap digunakan${skippedCount > 0 ? `, ${skippedCount} NIS/Token duplikat dilewati` : ''}. Tabel dibatasi ${Math.min(DPT_DISPLAY_LIMIT, orderedImported.length)} baris awal untuk hemat kuota.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCsvText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleDptbCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDptbCsvText(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportDptbCsv = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const existingNisSet = new Set(voters.map((v) => v.nis.trim()));
    const existingTokens = new Set(voters.map((v) => v.token));
    const { added, skippedCount, errors } = parseDptbVotersCsv(
      dptbCsvText,
      existingNisSet,
      existingTokens,
      MAX_CSV_VOTERS
    );

    if (added.length === 0) {
      onNotify(
        'error',
        'Import CSV DPTb Gagal',
        errors[0] ||
          (skippedCount > 0
            ? 'Semua ID pada data CSV sudah terdaftar di DPT atau DPTb.'
            : 'Tidak ada baris DPTb baru yang valid untuk diimpor.')
      );
      return;
    }

    setIsSaving(true);
    try {
      const mergedVoters = mergeDptbCsvVoters(voters, added);
      onSaveVoters(
        mergedVoters,
        'IMPORT_DPTB_CSV',
        `Mengimpor ${added.length} pemilih tambahan (DPTb) via CSV (${skippedCount} duplikat dilewati).`
      );
      setDptbSearchQuery('');
      setDptbCategoryFilter('ALL');
      setDptbStatusFilter('ALL');
      setDptbDisplayLimit(DPT_DISPLAY_LIMIT);
      setShowDptbImportModal(false);

      const extraNotes: string[] = [];
      if (skippedCount > 0) extraNotes.push(`${skippedCount} ID duplikat dilewati`);
      if (errors.length > 0) extraNotes.push(`${errors.length} baris dilewati karena format`);
      onNotify(
        'success',
        'Import CSV DPTb Berhasil',
        `${added.length} pemilih tambahan berhasil ditambahkan ke DPTb${
          extraNotes.length > 0 ? ` (${extraNotes.join(', ')})` : ''
        }.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportCsv = () => {
    const csv = exportVotersCsv(filteredVoters);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daftar-pemilih-tetap-osis-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify('success', 'Export CSV Berhasil', `${filteredVoters.length} data pemilih (DPT) diunduh.`);
  };

  const handleExportDptbCsv = () => {
    const header = 'ID,Nama Lengkap,Keterangan,Status Memilih,Waktu Memilih';
    const rows = filteredAdditionalVoters.map((v) => {
      const safeName = `"${v.name.replace(/"/g, '""')}"`;
      const safeKet = `"${v.kelas.replace(/"/g, '""')}"`;
      const status = v.hasVoted ? 'Sudah Memilih' : 'Belum Memilih';
      const votedAt = v.votedAt ? new Date(v.votedAt).toLocaleString('id-ID') : '-';
      return `${v.nis},${safeName},${safeKet},${status},"${votedAt}"`;
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daftar-pemilih-tambahan-dptb-osis-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify(
      'success',
      'Export DPTb CSV Berhasil',
      `${filteredAdditionalVoters.length} data pemilih tambahan (DPTb) diunduh.`
    );
  };

  const handlePrintVoterCards = async (targetVoters: Voter[], labelSuffix = 'Kartu-Pemilih-OSIS') => {
    if (isPrintingCards) return;
    if (targetVoters.length === 0) {
      onNotify('error', 'Data Pemilih Kosong', 'Tambahkan minimal satu pemilih sebelum mencetak Kartu Pemilih.');
      return;
    }
    setIsPrintingCards(true);
    try {
      const filename = await downloadVoterCardsPdf(targetVoters, settings, labelSuffix);
      onNotify(
        'success',
        'Kartu Pemilih PDF Siap',
        `${targetVoters.length} kartu pemilih dengan QR Code disimpan ke ${filename}.`
      );
    } catch (err) {
      console.error(err);
      onNotify('error', 'Gagal Cetak Kartu', 'Terjadi kesalahan saat membuat PDF Kartu Pemilih.');
    } finally {
      setIsPrintingCards(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!qrPreviewVoter) {
      setQrPreviewDataUrl('');
      return;
    }
    void generateVoterQrDataUrl(qrPreviewVoter).then((url) => {
      if (active) setQrPreviewDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, [qrPreviewVoter]);

  const selectedVotersList = useMemo(
    () => studentVoters.filter((v) => selectedIds.has(v.id)),
    [studentVoters, selectedIds]
  );

  const selectedDptbList = useMemo(
    () => additionalVoters.filter((v) => selectedDptbIds.has(v.id)),
    [additionalVoters, selectedDptbIds]
  );

  return (
    <div className="space-y-5">
      {/* Sub Menu Tabs: DPT Siswa vs DPT Tambahan (DPTb) */}
      <div
        role="tablist"
        aria-label="Sub Menu Manajemen DPT"
        className="bg-white border border-slate-200 rounded-2xl p-2 flex flex-wrap sm:flex-nowrap items-center gap-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSubMenu === 'DPT'}
          data-testid="submenu-dpt"
          onClick={() => setActiveSubMenu('DPT')}
          className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeSubMenu === 'DPT'
              ? 'bg-[var(--app-primary)] text-white font-bold shadow-xs'
              : 'text-slate-700 hover:bg-slate-100 font-semibold'
          }`}
        >
          <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Manajemen DPT Siswa</span>
          <span
            className={`font-mono text-xs tabular-nums ${
              activeSubMenu === 'DPT' ? 'text-amber-300' : 'text-slate-500'
            }`}
          >
            ({studentVoters.length})
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeSubMenu === 'DPTB'}
          data-testid="submenu-dptb"
          onClick={() => setActiveSubMenu('DPTB')}
          className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeSubMenu === 'DPTB'
              ? 'bg-[var(--app-primary)] text-white font-bold shadow-xs'
              : 'text-slate-700 hover:bg-slate-100 font-semibold'
          }`}
        >
          <UserCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Manajemen DPTb (Kepsek, Guru &amp; Tendik)</span>
          <span
            className={`font-mono text-xs tabular-nums ${
              activeSubMenu === 'DPTB' ? 'text-amber-300' : 'text-slate-500'
            }`}
          >
            ({additionalVoters.length})
          </span>
        </button>
      </div>

      {activeSubMenu === 'DPT' && (
        <div className="space-y-5">
          {/* Action Toolbar (DPT Siswa) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-extrabold text-slate-900">
                Manajemen Daftar Pemilih Tetap (DPT)
              </h2>
              <span className="text-xs font-semibold text-slate-500 tabular-nums">
                {studentVoters.length} Siswa · Urut Kelas X A s.d. XII E
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Kelola data siswa pemilih berdasarkan NIS / NISN, import CSV, dan ekspor daftar DPT.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => openAddModal('DPT')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Tambah Pemilih</span>
            </button>

            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-4 h-4 text-[#1E3A5F]" aria-hidden="true" />
              <span>Import CSV</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span>Export DPT (CSV)</span>
            </button>

            <button
              type="button"
              disabled={isPrintingCards}
              onClick={() =>
                void handlePrintVoterCards(
                  selectedIds.size > 0 ? selectedVotersList : filteredVoters
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-65 text-amber-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
            >
              {isPrintingCards ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-700" aria-hidden="true" />
                  <span>Menyiapkan Kartu...</span>
                </>
              ) : (
                <>
                  <Printer className="w-4 h-4 text-amber-700" aria-hidden="true" />
                  <span>
                    {selectedIds.size > 0
                      ? `Cetak Kartu Pemilih (${selectedIds.size})`
                      : 'Cetak Kartu Pemilih'}
                  </span>
                </>
              )}
            </button>

            {onOpenGoogleSheets && (
              <button
                type="button"
                onClick={onOpenGoogleSheets}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>Google Sheets</span>
              </button>
            )}
          </div>
        </div>

        {/* Search & Filters (DPT Siswa) */}
        <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-3 relative">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari NIS, nama, atau kelas..."
              aria-label="Cari pemilih berdasarkan NIS, nama, atau kelas"
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>

          <div className="lg:col-span-4 flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {(['ALL', 'X', 'XI', 'XII'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGradeFilter(g)}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  gradeFilter === g
                    ? 'bg-white text-[#0F1E3D] shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {g === 'ALL' ? 'Semua Kelas' : `Kelas ${g}`}
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Filter rombel kelas"
              className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            >
              <option value="ALL">Semua Rombel</option>
              {availableStudentClasses.map((cls) => (
                <option key={cls} value={cls}>
                  {cls}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'VOTED' | 'NOT_VOTED')}
              aria-label="Filter status memilih DPT"
              className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            >
              <option value="ALL">Semua Status ({studentVoters.length})</option>
              <option value="NOT_VOTED">
                Belum Memilih ({studentVoters.filter((v) => !v.hasVoted).length})
              </option>
              <option value="VOTED">
                Sudah Memilih ({studentVoters.filter((v) => v.hasVoted).length})
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* Bulk Selection Action Bar (DPT Siswa) */}
      {selectedIds.size > 0 && (
        <div
          role="region"
          aria-label="Aksi pilihan DPT"
          className="bg-amber-50 border border-amber-300 rounded-2xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <p className="text-sm font-bold text-slate-900">
            <span className="font-mono text-[#0F1E3D]">{selectedIds.size}</span> data pemilih
            dipilih
          </p>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap"
            >
              Batalkan Pilihan
            </button>
            <button
              type="button"
              disabled={isPrintingCards}
              onClick={() => void handlePrintVoterCards(selectedVotersList)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-70 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Cetak Kartu ({selectedIds.size})</span>
            </button>
            <button
              type="button"
              onClick={() => setBulkDeleteScope('DPT')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Hapus Terpilih ({selectedIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Voters Table (DPT Siswa) */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table data-testid="dpt-student-table" className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600">
                <th className="py-3.5 pl-4 pr-2 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={filteredVoters.length === 0}
                    onChange={toggleSelectAllVisible}
                    aria-label="Tandai semua data DPT yang ditampilkan"
                    className="w-4 h-4 rounded border-slate-300 text-[#0F1E3D] cursor-pointer"
                  />
                </th>
                <th className="py-3.5 px-4">NIS / NISN</th>
                <th className="py-3.5 px-4">Nama Lengkap</th>
                <th className="py-3.5 px-4">Kelas</th>
                <th className="py-3.5 px-4">Status Memilih</th>
                <th className="py-3.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {displayedVoters.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center text-slate-500">
                    Tidak ada data pemilih siswa yang cocok dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                displayedVoters.map((v) => {
                  const isChecked = selectedIds.has(v.id);
                  return (
                    <tr
                      key={v.id}
                      className={`transition-colors ${
                        isChecked ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-3 pl-4 pr-2 w-10">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectOne(v.id)}
                          aria-label={`Tandai ${v.name}`}
                          className="w-4 h-4 rounded border-slate-300 text-[#0F1E3D] cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {v.nis}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">{v.name}</td>
                      <td className="py-3 px-4 text-slate-600">{v.kelas}</td>
                      <td className="py-3 px-4">
                        {v.hasVoted ? (
                          <span className="text-xs font-semibold text-emerald-700">
                            Sudah Memilih
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-amber-700">
                            Belum Memilih
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setQrPreviewVoter(v)}
                            aria-label={`Lihat kartu QR ${v.name}`}
                            title="Lihat & Cetak Kartu QR Pemilih"
                            className="p-2 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 cursor-pointer"
                          >
                            <QrCode className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(v)}
                            aria-label={`Edit pemilih ${v.name}`}
                            className="p-2 rounded-lg text-slate-500 hover:text-[#1E3A5F] hover:bg-slate-100 cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(v)}
                            aria-label={`Hapus pemilih ${v.name}`}
                            className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>
            Menampilkan <strong className="font-mono text-slate-800">{displayedVoters.length}</strong>{' '}
            dari <strong className="font-mono text-slate-800">{filteredVoters.length}</strong> pemilih siswa{' '}
            {filteredVoters.length > DPT_DISPLAY_LIMIT && (
              <span className="text-slate-400">
                (dibatasi maks. {DPT_DISPLAY_LIMIT} baris awal untuk hemat kuota baca)
              </span>
            )}
          </span>
          {filteredVoters.length > displayedVoters.length && (
            <button
              type="button"
              onClick={() => setDisplayLimit((prev) => prev + DPT_DISPLAY_LIMIT)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Muat {Math.min(DPT_DISPLAY_LIMIT, filteredVoters.length - displayedVoters.length)} Berikutnya
            </button>
          )}
        </div>
      </div>
        </div>
      )}

      {/* Section 2: Manajemen Daftar Pemilih Tambahan (DPTb) */}
      {activeSubMenu === 'DPTB' && (
      <section aria-labelledby="dptb-section-heading" className="space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="dptb-section-heading" className="text-lg font-extrabold text-slate-900">
                  Manajemen Daftar Pemilih Tambahan (DPTb)
                </h2>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">
                  {additionalVoters.length} Pemilih Tambahan · Kepala Sekolah, Guru &amp; Tendik
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Khusus pemilih selain siswa seperti Kepala Sekolah, Guru, dan Tenaga Kependidikan (Tendik), diurutkan berdasarkan keterangan.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => openAddModal('DPTB')}
                data-testid="add-dptb-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Tambah DPTb</span>
              </button>

              <button
                type="button"
                onClick={() => setShowDptbImportModal(true)}
                data-testid="import-dptb-csv-btn"
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Upload className="w-4 h-4 text-[#1E3A5F]" aria-hidden="true" />
                <span>Import CSV DPTb</span>
              </button>

              <button
                type="button"
                onClick={handleExportDptbCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <span>Export DPTb (CSV)</span>
              </button>

              <button
                type="button"
                disabled={isPrintingCards}
                onClick={() =>
                  void handlePrintVoterCards(
                    selectedDptbIds.size > 0 ? selectedDptbList : filteredAdditionalVoters,
                    'Kartu-Pemilih-DPTb-OSIS'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-65 text-amber-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                {isPrintingCards ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-amber-700" aria-hidden="true" />
                    <span>Menyiapkan Kartu...</span>
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    <span>
                      {selectedDptbIds.size > 0
                        ? `Cetak Kartu DPTb (${selectedDptbIds.size})`
                        : 'Cetak Kartu DPTb'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Search & Filters (DPTb) */}
          <div className="pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-5 relative">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={dptbSearchQuery}
                onChange={(e) => setDptbSearchQuery(e.target.value)}
                placeholder="Cari ID, nama, atau keterangan..."
                aria-label="Cari pemilih tambahan berdasarkan ID, nama, atau keterangan"
                className="w-full h-10 pl-10 pr-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div className="md:col-span-4">
              <select
                value={dptbCategoryFilter}
                onChange={(e) => setDptbCategoryFilter(e.target.value)}
                aria-label="Filter keterangan DPTb"
                className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              >
                <option value="ALL">Semua Keterangan ({additionalVoters.length})</option>
                {availableDptbCategories.map((ket) => (
                  <option key={ket} value={ket}>
                    {ket}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <select
                value={dptbStatusFilter}
                onChange={(e) => setDptbStatusFilter(e.target.value as 'ALL' | 'VOTED' | 'NOT_VOTED')}
                aria-label="Filter status memilih DPTb"
                className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              >
                <option value="ALL">Semua Status ({additionalVoters.length})</option>
                <option value="NOT_VOTED">
                  Belum Memilih ({additionalVoters.filter((v) => !v.hasVoted).length})
                </option>
                <option value="VOTED">
                  Sudah Memilih ({additionalVoters.filter((v) => v.hasVoted).length})
                </option>
              </select>
            </div>
          </div>
        </div>

        {/* Bulk Selection Action Bar (DPTb) */}
        {selectedDptbIds.size > 0 && (
          <div
            role="region"
            aria-label="Aksi pilihan DPTb"
            className="bg-amber-50 border border-amber-300 rounded-2xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <p className="text-sm font-bold text-slate-900">
              <span className="font-mono text-[#0F1E3D]">{selectedDptbIds.size}</span> data DPTb
              dipilih
            </p>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedDptbIds(new Set())}
                className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap"
              >
                Batalkan Pilihan
              </button>
              <button
                type="button"
                disabled={isPrintingCards}
                onClick={() =>
                  void handlePrintVoterCards(selectedDptbList, 'Kartu-Pemilih-DPTb-OSIS')
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-70 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Cetak Kartu ({selectedDptbIds.size})</span>
              </button>
              <button
                type="button"
                onClick={() => setBulkDeleteScope('DPTB')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Hapus Terpilih ({selectedDptbIds.size})</span>
              </button>
            </div>
          </div>
        )}

        {/* DPTb Separate Table */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table data-testid="dptb-table" className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600">
                  <th className="py-3.5 pl-4 pr-2 w-10">
                    <input
                      ref={selectAllDptbRef}
                      type="checkbox"
                      checked={allVisibleDptbSelected}
                      disabled={filteredAdditionalVoters.length === 0}
                      onChange={toggleSelectAllVisibleDptb}
                      aria-label="Tandai semua data DPTb yang ditampilkan"
                      className="w-4 h-4 rounded border-slate-300 text-[#0F1E3D] cursor-pointer"
                    />
                  </th>
                  <th className="py-3.5 px-4">ID</th>
                  <th className="py-3.5 px-4">Nama Lengkap</th>
                  <th className="py-3.5 px-4">Keterangan</th>
                  <th className="py-3.5 px-4">Status Memilih</th>
                  <th className="py-3.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {displayedAdditionalVoters.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 px-4 text-center text-slate-500">
                      <p>Belum ada data pemilih tambahan (DPTb) yang sesuai dengan filter.</p>
                      <button
                        type="button"
                        onClick={() => openAddModal('DPTB')}
                        className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-xs font-bold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Tambah DPTb Pertama</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  displayedAdditionalVoters.map((v) => {
                    const isChecked = selectedDptbIds.has(v.id);
                    return (
                      <tr
                        key={v.id}
                        className={`transition-colors ${
                          isChecked ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2 w-10">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectOneDptb(v.id)}
                            aria-label={`Tandai ${v.name}`}
                            className="w-4 h-4 rounded border-slate-300 text-[#0F1E3D] cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {v.nis}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{v.name}</td>
                        <td className="py-3 px-4 text-slate-600">{v.kelas}</td>
                        <td className="py-3 px-4">
                          {v.hasVoted ? (
                            <span className="text-xs font-semibold text-emerald-700">
                              Sudah Memilih
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-amber-700">
                              Belum Memilih
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setQrPreviewVoter(v)}
                              aria-label={`Lihat kartu QR ${v.name}`}
                              title="Lihat & Cetak Kartu QR Pemilih"
                              className="p-2 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 cursor-pointer"
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(v)}
                              aria-label={`Edit DPTb ${v.name}`}
                              className="p-2 rounded-lg text-slate-500 hover:text-[#1E3A5F] hover:bg-slate-100 cursor-pointer"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(v)}
                              aria-label={`Hapus DPTb ${v.name}`}
                              className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
            <span>
              Menampilkan{' '}
              <strong className="font-mono text-slate-800">{displayedAdditionalVoters.length}</strong>{' '}
              dari{' '}
              <strong className="font-mono text-slate-800">{filteredAdditionalVoters.length}</strong>{' '}
              pemilih tambahan (DPTb)
            </span>
            {filteredAdditionalVoters.length > displayedAdditionalVoters.length && (
              <button
                type="button"
                onClick={() => setDptbDisplayLimit((prev) => prev + DPT_DISPLAY_LIMIT)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Muat{' '}
                {Math.min(
                  DPT_DISPLAY_LIMIT,
                  filteredAdditionalVoters.length - displayedAdditionalVoters.length
                )}{' '}
                Berikutnya
              </button>
            )}
          </div>
        </div>
      </section>
      )}

      {/* Add/Edit Modal (DPT & DPTb) */}
      {showFormModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dpt-form-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 id="dpt-form-title" className="text-base font-extrabold text-slate-900">
                {formMode === 'DPTB'
                  ? editingVoter
                    ? 'Edit Data DPTb'
                    : 'Tambah Pemilih Tambahan (DPTb)'
                  : editingVoter
                    ? 'Edit Data Pemilih'
                    : 'Tambah Pemilih Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                aria-label="Tutup form pemilih"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-6 space-y-4">
              <div>
                <label htmlFor="dpt-nis" className="block text-xs font-bold text-slate-700 mb-1">
                  {formMode === 'DPTB'
                    ? 'ID (Digunakan untuk Login Pemilih)'
                    : 'NIS / NISN (Digunakan untuk Login Pemilih)'}
                </label>
                <input
                  id="dpt-nis"
                  type="text"
                  value={formNis}
                  onChange={(e) => setFormNis(e.target.value)}
                  placeholder={formMode === 'DPTB' ? '2026038' : '2024031'}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono text-sm"
                />
              </div>

              <div>
                <label htmlFor="dpt-name" className="block text-xs font-bold text-slate-700 mb-1">
                  {formMode === 'DPTB' ? 'Nama Lengkap' : 'Nama Lengkap Siswa'}
                </label>
                <input
                  id="dpt-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={formMode === 'DPTB' ? 'Nama lengkap pemilih' : 'Nama siswa'}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label htmlFor="dpt-kelas" className="block text-xs font-bold text-slate-700 mb-1">
                  {formMode === 'DPTB'
                    ? 'Keterangan (Contoh: Kepala Sekolah, Guru, TENDIK)'
                    : 'Kelas (Contoh: X A, XI B, XII E)'}
                </label>
                <input
                  id="dpt-kelas"
                  type="text"
                  list={formMode === 'DPTB' ? 'dptb-keterangan-options' : undefined}
                  value={formKelas}
                  onChange={(e) => setFormKelas(e.target.value)}
                  placeholder={formMode === 'DPTB' ? 'Kepala Sekolah' : 'X A'}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
                {formMode === 'DPTB' && (
                  <datalist id="dptb-keterangan-options">
                    <option value="Kepala Sekolah" />
                    <option value="Wakil Kepala Sekolah" />
                    <option value="Guru" />
                    <option value="TENDIK" />
                    <option value="Staf TU" />
                  </datalist>
                )}
              </div>

              {editingVoter && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center gap-2">
                    <input
                      id="dpt-status"
                      type="checkbox"
                      checked={formHasVoted}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormHasVoted(checked);
                        if (!checked) {
                          setFormVotedCandidateId('');
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                    <label htmlFor="dpt-status" className="text-xs font-semibold text-slate-700">
                      Tandai sudah menggunakan hak suara
                    </label>
                  </div>

                  {formHasVoted && (
                    <div
                      id="dpt-voted-paslon-panel"
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5"
                    >
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          Paslon Ketua &amp; Wakil Ketua yang Dipilih
                        </p>
                        {selectedChosenCandidate ? (
                          <div className="mt-1.5 flex items-start gap-2.5">
                            <span
                              className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold text-white shrink-0 mt-0.5"
                              style={{ backgroundColor: selectedChosenCandidate.accentColor || 'var(--app-primary)' }}
                            >
                              0{selectedChosenCandidate.nomorUrut}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-extrabold text-slate-900">
                                {selectedChosenCandidate.ketuaName} &amp; {selectedChosenCandidate.wakilName}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {selectedChosenCandidate.ketuaClass} · {selectedChosenCandidate.wakilClass}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1 text-xs font-medium text-amber-700">
                            Pilihan pasangan calon belum tercatat pada pemilih ini.
                          </p>
                        )}
                      </div>

                      {isSuperAdmin ? (
                        <div className="pt-2 border-t border-slate-200/80">
                          <label
                            htmlFor="dpt-voted-candidate"
                            className="block text-[11px] font-bold text-slate-700 mb-1"
                          >
                            Ubah Paslon Pilihan (Khusus SuperAdmin)
                          </label>
                          <select
                            id="dpt-voted-candidate"
                            value={formVotedCandidateId}
                            onChange={(e) => setFormVotedCandidateId(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)]"
                          >
                            <option value="">-- Belum Ditentukan --</option>
                            {sortedCandidates.map((cand) => (
                              <option key={cand.id} value={cand.id}>
                                Paslon 0{cand.nomorUrut} — {cand.ketuaName} &amp; {cand.wakilName}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] text-slate-500 mt-1">
                            Perolehan suara paslon otomatis disesuaikan saat perubahan disimpan.
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-200/80">
                          Hanya SuperAdmin yang dapat mengubah pasangan calon yang dipilih.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                      <span>Menyimpan Data...</span>
                    </>
                  ) : (
                    <span>Simpan Data</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import CSV Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-csv-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 id="import-csv-title" className="text-base font-extrabold text-slate-900">
                Simulasi Import DPT via CSV
              </h3>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                aria-label="Tutup modal import CSV"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleImportCsv} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Unggah File .CSV (Opsional) atau Tempel Data di Bawah
                </label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileUpload}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
                />
              </div>

              <div>
                <label htmlFor="csv-textarea" className="block text-xs font-bold text-slate-700 mb-1">
                  Format: <span className="font-mono font-normal">NIS,Nama,Kelas</span>
                </label>
                <textarea
                  id="csv-textarea"
                  rows={6}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-300 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Mendukung hingga <strong>999 pemilih</strong> per import (dipecah otomatis maks. 450 dokumen/batch). Status memilih disetel ke belum memilih, rekap total DPT diperbarui, dan perolehan suara paslon direset ke 0.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setShowImportModal(false)}
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
                      <span>Mengimpor CSV...</span>
                    </>
                  ) : (
                    <span>Proses Import CSV</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import CSV Modal (DPTb) */}
      {showDptbImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-dptb-csv-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 id="import-dptb-csv-title" className="text-base font-extrabold text-slate-900">
                Import Pemilih Tambahan (DPTb) via CSV
              </h3>
              <button
                type="button"
                onClick={() => setShowDptbImportModal(false)}
                aria-label="Tutup modal import CSV DPTb"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleImportDptbCsv} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Unggah File .CSV (Opsional) atau Tempel Data di Bawah
                </label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleDptbCsvFileUpload}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="dptb-csv-textarea"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Format: <span className="font-mono font-normal">ID,Nama,Keterangan</span>
                </label>
                <textarea
                  id="dptb-csv-textarea"
                  data-testid="dptb-csv-textarea"
                  rows={6}
                  value={dptbCsvText}
                  onChange={(e) => setDptbCsvText(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-300 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Import ini hanya <strong>menambahkan data DPTb baru</strong> (Kepala Sekolah,
                  Guru, TENDIK) tanpa menghapus DPT siswa maupun mereset perolehan suara yang sudah
                  masuk.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setShowDptbImportModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  data-testid="submit-dptb-csv-btn"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white text-xs font-bold cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      <span>Mengimpor DPTb...</span>
                    </>
                  ) : (
                    <span>Proses Import DPTb</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-voter-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-xl">
            <h3 id="delete-voter-title" className="text-lg font-extrabold text-slate-900">
              Hapus Data Pemilih?
            </h3>
            <p className="text-sm text-slate-600 mt-2">
              Anda yakin ingin menghapus <strong>{deleteTarget.name}</strong> (
              {isAdditionalVoter(deleteTarget) ? 'ID' : 'NIS'}{' '}
              <span className="font-mono">{deleteTarget.nis}</span>) dari{' '}
              {isAdditionalVoter(deleteTarget)
                ? 'Daftar Pemilih Tambahan (DPTb)'
                : 'Daftar Pemilih Tetap'}
              ?
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
                  <span>Hapus Pemilih</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkDeleteScope && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-voter-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-xl">
            <h3 id="bulk-delete-voter-title" className="text-lg font-extrabold text-slate-900">
              Hapus {activeBulkSelectionSet.size} Data{' '}
              {bulkDeleteScope === 'DPTB' ? 'DPTb' : 'DPT'} Terpilih?
            </h3>
            <p className="text-sm text-slate-600 mt-2">
              Seluruh <strong>{activeBulkSelectionSet.size}</strong> pemilih yang Anda tandai akan
              dihapus secara permanen dari{' '}
              {bulkDeleteScope === 'DPTB'
                ? 'Daftar Pemilih Tambahan (DPTb)'
                : 'Daftar Pemilih Tetap'}
              .
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setBulkDeleteScope(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmBulkDelete}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-75 text-white text-xs font-bold cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <span>Ya, Hapus ({activeBulkSelectionSet.size})</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Voter QR Card Preview Modal */}
      {qrPreviewVoter && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-card-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[var(--app-primary)] text-white flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-mono font-bold text-amber-300 uppercase">
                  KARTU PEMILIH E-VOTING OSIS
                </p>
                <h3 id="qr-card-modal-title" className="text-sm font-extrabold truncate">
                  {settings.schoolName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQrPreviewVoter(null)}
                aria-label="Tutup pratinjau kartu pemilih"
                className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-28 h-28 rounded-xl border border-slate-200 bg-slate-50 p-1.5 flex items-center justify-center shrink-0">
                  {qrPreviewDataUrl ? (
                    <img
                      src={qrPreviewDataUrl}
                      alt={`QR Code Kartu Pemilih ${qrPreviewVoter.name}`}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" aria-hidden="true" />
                  )}
                </div>

                <div className="min-w-0 space-y-1.5">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-400">Nama Pemilih</p>
                    <p className="text-sm font-extrabold text-slate-900 leading-snug">
                      {qrPreviewVoter.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-400">
                      {isAdditionalVoter(qrPreviewVoter) ? 'ID' : 'NIS / NISN'}
                    </p>
                    <p className="text-sm font-mono font-bold text-[var(--app-primary)]">
                      {qrPreviewVoter.nis}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-400">
                      {isAdditionalVoter(qrPreviewVoter) ? 'Keterangan' : 'Kelas'}
                    </p>
                    <p className="text-xs font-semibold text-slate-700">{qrPreviewVoter.kelas}</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setQrPreviewVoter(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={isPrintingCards}
                  onClick={() =>
                    void handlePrintVoterCards(
                      [qrPreviewVoter],
                      `Kartu-Pemilih-${qrPreviewVoter.nis}`
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-70 text-white text-xs font-bold cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Cetak Kartu PDF</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
