import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import {
  CHANNEL_LABELS,
  DECISION_LABELS,
  type ActivityLog,
  type EmployeeEvaluation,
  type WeeklyBatch,
} from '../types';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decisionSummaryArabic(ev: EmployeeEvaluation): string {
  if (ev.decision === 'reward' || ev.decision === 'allow_same') return 'تم السماح (مكافأة)';
  if (ev.decision === 'allow_with_warning') return 'تم السماح (مع تنبيه)';
  if (ev.decision === 'deny_reward') return 'لم يُسمح (مرفوض)';
  return 'بانتظار القرار';
}

function notifStatusArabic(status: EmployeeEvaluation['lastNotificationStatus']): string {
  if (status === 'sent') return 'تم الإرسال';
  if (status === 'failed') return 'فشل الإرسال';
  if (status === 'partial') return 'إرسال جزئي';
  return 'لم يُرسل بعد';
}

export function exportWeeklyExcel(
  batch: WeeklyBatch,
  evaluations: EmployeeEvaluation[],
  logs: ActivityLog[]
): void {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  // Sheet 1: Summary & Manager Decisions
  const summaryRows = evaluations.map((ev) => ({
    'الرقم الوظيفي': ev.empCode,
    'اسم الموظف': ev.employeeName,
    القسم: ev.department,
    'رقم الواتساب': ev.phone || '—',
    'البريد الإلكتروني': ev.email || '—',
    'أيام الحضور': ev.presentDays,
    'أيام التأخير': ev.lateDaysCount,
    'إجمالي دقائق التأخير': ev.totalLateMinutes,
    'البصمات الناقصة': ev.missingPunchDays,
    'أيام الغياب': ev.absentDays,
    'حالة الالتزام': ev.isCompliant ? 'ملتزم' : 'غير ملتزم',
    'قرار المدير': DECISION_LABELS[ev.decision],
    'ملخص السماح': decisionSummaryArabic(ev),
    'حالة الإرسال': notifStatusArabic(ev.lastNotificationStatus),
  }));

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
    { wch: 16 },
    { wch: 24 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 28 },
    { wch: 20 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'الملخص والقرارات');

  // Sheet 2: Daily Punches (Sunday to Thursday)
  const dailyRows: Record<string, string | number>[] = [];
  for (const ev of evaluations) {
    for (const d of ev.days) {
      dailyRows.push({
        'الرقم الوظيفي': ev.empCode,
        'اسم الموظف': ev.employeeName,
        اليوم: d.dayNameAr,
        التاريخ: d.date,
        'أول بصمة': d.firstIn || '—',
        'آخر بصمة': d.lastOut || '—',
        'دقائق التأخير': d.lateMinutes,
        'انصراف مبكر (د)': d.earlyLeaveMinutes,
        الحالة: d.excused
          ? 'مستثنى (إجازة/استئذان)'
          : d.absent
          ? 'غائب'
          : d.missingPunch
          ? 'بصمة ناقصة'
          : d.lateMinutes > 0
          ? 'متأخر'
          : d.earlyLeaveMinutes > 0
          ? 'انصراف مبكر'
          : 'منتظم',
      });
    }
  }
  const wsDaily = XLSX.utils.json_to_sheet(dailyRows);
  wsDaily['!cols'] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDaily, 'تفاصيل البصمات اليومية');

  // Sheet 3: Activity Log
  const weekLogs = logs.filter((l) => l.weekKey === batch.weekKey);
  const logRows = weekLogs.map((l) => ({
    التوقيت: l.createdAt ? new Date(l.createdAt).toLocaleString('ar-SA') : '—',
    'الرقم الوظيفي': l.empCode,
    'اسم الموظف': l.employeeName,
    القرار: DECISION_LABELS[l.decision],
    القناة: CHANNEL_LABELS[l.channel],
    المستلم: l.recipient || '—',
    الحالة: l.status === 'sent' ? 'تم الإرسال' : l.status === 'failed' ? 'فشل' : 'قيد الانتظار',
    الملاحظة: l.errorMessage || '—',
  }));
  const wsLogs = XLSX.utils.json_to_sheet(
    logRows.length > 0
      ? logRows
      : [{ الملاحظة: 'لا توجد عمليات إرسال مسجلة لهذا الأسبوع بعد.' }]
  );
  wsLogs['!cols'] = [
    { wch: 22 },
    { wch: 14 },
    { wch: 24 },
    { wch: 26 },
    { wch: 14 },
    { wch: 22 },
    { wch: 14 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, wsLogs, 'سجل الإرسال');

  XLSX.writeFile(wb, `تقرير-انضباط-${batch.weekKey}.xlsx`);
}

export async function exportWeeklyPdf(
  batch: WeeklyBatch,
  evaluations: EmployeeEvaluation[]
): Promise<void> {
  const allowedCount = evaluations.filter(
    (e) => e.decision === 'reward' || e.decision === 'allow_same' || e.decision === 'allow_with_warning'
  ).length;
  const deniedCount = evaluations.filter((e) => e.decision === 'deny_reward').length;
  const pendingCount = evaluations.filter((e) => e.decision === 'pending').length;
  const sentCount = evaluations.filter((e) => e.lastNotificationStatus === 'sent').length;

  const container = document.createElement('div');
  container.dir = 'rtl';
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '1120px';
  container.style.background = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = '"IBM Plex Sans Arabic", "Readex Pro", sans-serif';
  container.style.padding = '32px';
  container.style.boxSizing = 'border-box';

  const rowsHtml = evaluations
    .map((ev, index) => {
      const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      const decisionColor =
        ev.decision === 'reward' || ev.decision === 'allow_same'
          ? '#15803d'
          : ev.decision === 'allow_with_warning'
          ? '#b45309'
          : ev.decision === 'deny_reward'
          ? '#b91c1c'
          : '#475569';

      const sunThuSummary = ev.days
        .map((d) => `${d.dayNameAr.slice(0, 5)}: ${d.firstIn || '—'}/${d.lastOut || '—'}`)
        .join(' | ');

      return `
        <tr style="background:${bg}; border-bottom:1px solid #e2e8f0;">
          <td style="padding:10px 8px; font-family:'IBM Plex Mono',monospace; font-size:12px;">${escapeHtml(ev.empCode)}</td>
          <td style="padding:10px 8px; font-weight:600; font-size:13px;">${escapeHtml(ev.employeeName)}<div style="font-weight:400; color:#64748b; font-size:11px;">${escapeHtml(ev.department)}</div></td>
          <td style="padding:10px 8px; font-size:12px;">${ev.isCompliant ? '<span style="color:#15803d; font-weight:600;">ملتزم</span>' : '<span style="color:#b91c1c; font-weight:600;">غير ملتزم</span>'}</td>
          <td style="padding:10px 8px; font-family:'IBM Plex Mono',monospace; font-size:12px;">${ev.totalLateMinutes} د (${ev.lateDaysCount} أيام)</td>
          <td style="padding:10px 8px; font-family:'IBM Plex Mono',monospace; font-size:12px;">ناقص: ${ev.missingPunchDays} · غياب: ${ev.absentDays}</td>
          <td style="padding:10px 8px; font-size:11px; color:#334155; font-family:'IBM Plex Mono',monospace;">${escapeHtml(sunThuSummary)}</td>
          <td style="padding:10px 8px; font-size:12px; font-weight:600; color:${decisionColor};">${escapeHtml(decisionSummaryArabic(ev))}</td>
          <td style="padding:10px 8px; font-size:12px; color:#334155;">${escapeHtml(notifStatusArabic(ev.lastNotificationStatus))}</td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <div style="border-bottom:2px solid #0f766e; padding-bottom:16px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:flex-end;">
      <div>
        <div style="font-size:22px; font-weight:700; color:#0f172a;">تقرير الالتزام الأسبوعي ومكافأة الخروج المبكر</div>
        <div style="font-size:13px; color:#475569; margin-top:4px;">الأسبوع: ${escapeHtml(batch.weekLabel)} · الملف: ${escapeHtml(batch.fileName)}</div>
      </div>
      <div style="text-align:left; font-size:12px; color:#64748b;">
        <div>نظام انضباط</div>
        <div>تاريخ الإصدار: ${new Date().toLocaleDateString('ar-SA')}</div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:12px; margin-bottom:20px;">
      <div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; background:#f8fafc;">
        <div style="font-size:11px; color:#64748b;">إجمالي الموظفين</div>
        <div style="font-size:20px; font-weight:700; font-family:'IBM Plex Mono',monospace; margin-top:4px;">${evaluations.length}</div>
      </div>
      <div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; background:#f0fdf4;">
        <div style="font-size:11px; color:#15803d;">تم السماح لهم</div>
        <div style="font-size:20px; font-weight:700; color:#15803d; font-family:'IBM Plex Mono',monospace; margin-top:4px;">${allowedCount}</div>
      </div>
      <div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; background:#fef2f2;">
        <div style="font-size:11px; color:#b91c1c;">لم يُسمح لهم</div>
        <div style="font-size:20px; font-weight:700; color:#b91c1c; font-family:'IBM Plex Mono',monospace; margin-top:4px;">${deniedCount}</div>
      </div>
      <div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; background:#fffbeb;">
        <div style="font-size:11px; color:#b45309;">بانتظار القرار</div>
        <div style="font-size:20px; font-weight:700; color:#b45309; font-family:'IBM Plex Mono',monospace; margin-top:4px;">${pendingCount}</div>
      </div>
      <div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; background:#f0fdfa;">
        <div style="font-size:11px; color:#0f766e;">تم إشعارهم</div>
        <div style="font-size:20px; font-weight:700; color:#0f766e; font-family:'IBM Plex Mono',monospace; margin-top:4px;">${sentCount}</div>
      </div>
    </div>

    <table style="width:100%; border-collapse:collapse; text-align:right;">
      <thead>
        <tr style="background:#0f172a; color:#ffffff; font-size:12px;">
          <th style="padding:10px 8px;">الرقم</th>
          <th style="padding:10px 8px;">الموظف</th>
          <th style="padding:10px 8px;">الالتزام</th>
          <th style="padding:10px 8px;">التأخير</th>
          <th style="padding:10px 8px;">المخالفات</th>
          <th style="padding:10px 8px;">ملخص الأحد–الخميس (دخول/خروج)</th>
          <th style="padding:10px 8px;">القرار</th>
          <th style="padding:10px 8px;">الإرسال</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  document.body.appendChild(container);
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const printableW = pageWidth - margin * 2;
    const printableH = pageHeight - margin * 2;
    const imgHeight = (canvas.height * printableW) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, 'PNG', margin, position, printableW, imgHeight);
    heightLeft -= printableH;

    while (heightLeft > 0) {
      pdf.addPage();
      position = margin - (imgHeight - heightLeft);
      pdf.addImage(imgData, 'PNG', margin, position, printableW, imgHeight);
      heightLeft -= printableH;
    }

    pdf.save(`تقرير-انضباط-${batch.weekKey}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

export function downloadSampleZKTecoFile(content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'attlog_sample_zkteco.dat';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
