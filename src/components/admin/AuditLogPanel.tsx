import { History } from 'lucide-react';
import type { AuditLogEntry } from '../../types/evoting';

interface AuditLogPanelProps {
  logs: AuditLogEntry[];
}

export function AuditLogPanel({ logs }: AuditLogPanelProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-3">
        <History className="w-5 h-5 text-[#1E3A5F] shrink-0" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">
            Log Aktivitas (Audit Trail)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Rekaman waktu login admin dan perubahan data penting pada sistem pemilihan.
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600">
                <th className="py-3.5 px-4">Waktu</th>
                <th className="py-3.5 px-4">Aktor / Pengelola</th>
                <th className="py-3.5 px-4">Aksi</th>
                <th className="py-3.5 px-4">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 px-4 text-center text-slate-500">
                    Belum ada catatan aktivitas.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap tabular-nums">
                      {new Date(log.timestamp).toLocaleString('id-ID', {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900 text-xs sm:text-sm">
                        {log.actorName}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">{log.actorRole}</p>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs font-bold text-[#1E3A5F] whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 text-xs sm:text-sm text-slate-700">{log.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
