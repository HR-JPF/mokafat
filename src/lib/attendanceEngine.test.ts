import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWhatsAppWebUrl,
  evaluateWeek,
  getAvailableWeeks,
  groupEvaluationsByWorkflow,
  normalizePhoneNumber,
  parseSpreadsheetMatrix,
  parseZKTecoText,
  recalculateSingleEvaluation,
  renderDecisionMessage,
  resolveEvaluationsWithDirectory,
} from './attendanceEngine';
import { DEFAULT_SETTINGS, type Employee, type EmployeeEvaluation } from '../types';

const SAMPLE_EMPLOYEES: Employee[] = [
  {
    id: 'e1',
    ownerId: 'demo',
    empCode: '101',
    name: 'سالم العتيبي',
    department: 'التقنية',
    phone: '0501234567',
    email: 'salem@company.sa',
    active: true,
  },
  {
    id: 'e2',
    ownerId: 'demo',
    empCode: '102',
    name: 'نورة القحطاني',
    department: 'المالية',
    phone: '966559876543',
    email: 'noura@company.sa',
    active: true,
  },
];

const SAMPLE_ZKTECO = [
  // Emp 101: Fully compliant Sun-Wed (in <= 08:15, out >= 15:50) + Thu morning in 08:02 only
  '101\t2026-11-22 07:55:12\t1\t0\t1\t0',
  '101\t2026-11-22 16:04:00\t1\t1\t1\t0',
  '101\t2026-11-23 08:10:00\t1\t0\t1\t0',
  '101\t2026-11-23 16:00:00\t1\t1\t1\t0',
  '101\t2026-11-24 07:58:00\t1\t0\t1\t0',
  '101\t2026-11-24 16:12:00\t1\t1\t1\t0',
  '101\t2026-11-25 08:05:00\t1\t0\t1\t0',
  '101\t2026-11-25 15:55:00\t1\t1\t1\t0',
  '101\t2026-11-26 08:02:00\t1\t0\t1\t0',

  // Emp 102: Late on Sunday (08:35), double-tap missing checkout on Monday (07:58 & 08:00), absent Tuesday
  '102\t2026-11-22 08:35:00\t1\t0\t1\t0',
  '102\t2026-11-22 16:05:00\t1\t1\t1\t0',
  '102\t2026-11-23 07:58:00\t1\t0\t1\t0',
  '102\t2026-11-23 08:00:00\t1\t0\t1\t0',
  '102\t2026-11-25 08:00:00\t1\t0\t1\t0',
  '102\t2026-11-25 16:00:00\t1\t1\t1\t0',
  '102\t2026-11-26 08:04:00\t1\t0\t1\t0',

  // Emp 999: Unmapped employee in file
  '999\t2026-11-22 08:00:00\t1\t0\t1\t0',
  '999\t2026-11-22 16:00:00\t1\t1\t1\t0',
].join('\n');

test('parseZKTecoText extracts punches accurately and detects Sunday-Thursday week', () => {
  const punches = parseZKTecoText(SAMPLE_ZKTECO);
  assert.equal(punches.length, 18);
  const weeks = getAvailableWeeks(punches);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].sundayDate, '2026-11-22');
  assert.equal(weeks[0].thursdayDate, '2026-11-26');
});

test('parseSpreadsheetMatrix handles ZKTeco BioTime First & Last report with title row and Excel serial dates', () => {
  const matrix: unknown[][] = [
    ['First & Last', '', '', '', '', '', '', ''],
    ['Employee ID', 'First Name', 'Department', 'Date', 'Weekday', 'First Punch', 'Last Punch', 'Total Time'],
    // 46348 = 2026-11-22 (Sunday), 0.3333333 = 08:00, 0.6736111 = 16:10
    ['201', 'أحمد الحربي', 'IT', 46348, 'Sun', 0.3333333, 0.6736111, '08:10'],
    ['201', 'أحمد الحربي', 'IT', '2026-11-23', 'Mon', '08:05:10', '16:02:00', '07:57'],
    ['201', 'أحمد الحربي', 'IT', '24/11/2026', 'Tue', '8:10 AM', '4:05 PM', '07:55'],
    ['201', 'أحمد الحربي', 'IT', '11/25/2026', 'Wed', '07:58', '16:00', '08:02'],
    ['201', 'أحمد الحربي', 'IT', '26-Nov-2026', 'Thu', '08:02', '-', ''],
  ];

  const { punches, discoveredEmployees } = parseSpreadsheetMatrix(matrix);
  assert.equal(discoveredEmployees.length, 1);
  assert.equal(discoveredEmployees[0].name, 'أحمد الحربي');
  assert.equal(discoveredEmployees[0].department, 'IT');

  const weeks = getAvailableWeeks(punches);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].sundayDate, '2026-11-22');

  const { evaluations } = evaluateWeek(punches, '2026-11-22', [], DEFAULT_SETTINGS);
  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].employeeName, 'أحمد الحربي');
  assert.equal(evaluations[0].department, 'IT');
  assert.equal(evaluations[0].isCompliant, true);
  assert.equal(evaluations[0].decision, 'reward');
  assert.equal(evaluations[0].days[2].firstIn, '08:10');
  assert.equal(evaluations[0].days[2].lastOut, '16:05');
});

test('parseZKTecoText parses tab-separated BioTime First & Last text files', () => {
  const tsv = [
    'First & Last\t\t\t\t\t\t\t',
    'Employee ID\tFirst Name\tDepartment\tDate\tWeekday\tFirst Punch\tLast Punch\tTotal Time',
    '301\tفهد الشمري\tOperations\t2026-11-22\tSun\t08:25\t16:00\t07:35',
    '301\tفهد الشمري\tOperations\t2026-11-23\tMon\t08:00\t16:05\t08:05',
  ].join('\n');

  const punches = parseZKTecoText(tsv);
  assert.equal(punches.length, 4);
  const weeks = getAvailableWeeks(punches);
  assert.equal(weeks[0].sundayDate, '2026-11-22');
});

test('evaluateWeek honors Thursday morning-only mode and flags double-tap missing checkout', () => {
  const punches = parseZKTecoText(SAMPLE_ZKTECO);
  const { evaluations, unmappedCodes } = evaluateWeek(
    punches,
    '2026-11-22',
    SAMPLE_EMPLOYEES,
    DEFAULT_SETTINGS
  );

  assert.deepEqual(unmappedCodes, ['999']);

  const salem = evaluations.find((e) => e.empCode === '101')!;
  assert.equal(salem.isCompliant, true);
  assert.equal(salem.decision, 'reward');
  assert.equal(salem.missingPunchDays, 0);
  assert.equal(salem.days[4].firstIn, '08:02');
  assert.equal(salem.days[4].lastOut, null);
  assert.equal(salem.days[4].status, 'on_time');

  const noura = evaluations.find((e) => e.empCode === '102')!;
  assert.equal(noura.isCompliant, false);
  assert.equal(noura.decision, 'pending');
  assert.equal(noura.lateDaysCount, 1);
  assert.equal(noura.totalLateMinutes, 35);
  assert.equal(noura.missingPunchDays, 1); // Monday 07:58 & 08:00 treated as missing checkout
  assert.equal(noura.absentDays, 1); // Tuesday absent
});

test('disabling thursdayMorningOnly flags Thursday single punch as missing checkout', () => {
  const punches = parseZKTecoText(SAMPLE_ZKTECO);
  const strictSettings = { ...DEFAULT_SETTINGS, thursdayMorningOnly: false };
  const { evaluations } = evaluateWeek(punches, '2026-11-22', SAMPLE_EMPLOYEES, strictSettings);

  const salem = evaluations.find((e) => e.empCode === '101')!;
  assert.equal(salem.isCompliant, false);
  assert.equal(salem.missingPunchDays, 1);
  assert.equal(salem.days[4].status, 'missing_punch');
});

test('excusing non-compliant days recalculates employee into compliant reward state', () => {
  const punches = parseZKTecoText(SAMPLE_ZKTECO);
  const { evaluations } = evaluateWeek(punches, '2026-11-22', SAMPLE_EMPLOYEES, DEFAULT_SETTINGS);
  const nouraBase = evaluations.find((e) => e.empCode === '102')!;
  const fullEv: EmployeeEvaluation = {
    ...nouraBase,
    id: 'ev-102',
    ownerId: 'demo',
    batchId: 'b1',
  };

  const excused = recalculateSingleEvaluation(fullEv, '2026-11-22', DEFAULT_SETTINGS, [
    '2026-11-22',
    '2026-11-23',
    '2026-11-24',
  ]);
  assert.equal(excused.isCompliant, true);
  assert.equal(excused.decision, 'reward');
  assert.equal(excused.totalLateMinutes, 0);
  assert.equal(excused.absentDays, 0);
});

test('renderDecisionMessage substitutes Arabic placeholders and phone normalization works', () => {
  const msg = renderDecisionMessage(
    'allow_with_warning',
    {
      employeeName: 'نورة القحطاني',
      totalLateMinutes: 35,
      lateDaysCount: 1,
      missingPunchDays: 1,
      absentDays: 0,
    },
    '2026-11-22 إلى 2026-11-26',
    DEFAULT_SETTINGS
  );
  assert.ok(msg.includes('نورة القحطاني'));
  assert.ok(msg.includes('35 دقيقة'));
  assert.equal(normalizePhoneNumber('050 123 4567', '966'), '966501234567');
  assert.equal(normalizePhoneNumber('٠٥٥١٢٣٤٥٦٧', '966'), '966551234567');
  assert.equal(normalizePhoneNumber('+966 050 123 4567', '966'), '966501234567');
  assert.ok(
    buildWhatsAppWebUrl('٠٥٠١٢٣٤٥٦٧', 'مرحبا')?.startsWith(
      'https://web.whatsapp.com/send?phone=966501234567&text='
    )
  );
});

test('evaluateWeek links directory employee across leading zeros and BioTime First Name without duplicates', () => {
  const dir: Employee[] = [
    {
      id: 'dir-nabil',
      ownerId: 'demo',
      empCode: '1',
      name: 'نبيل أحمد الغامدي',
      department: 'المبيعات',
      phone: '٠٥٥٩٩٨٨٧٧٦',
      email: 'nabil@company.sa',
      active: true,
    },
    {
      id: 'dir-omar',
      ownerId: 'demo',
      empCode: '105',
      name: 'عمر السبيعي',
      department: 'التقنية',
      phone: '0501112233',
      email: 'omar@company.sa',
      active: true,
    },
  ];

  const matrix: unknown[][] = [
    ['First & Last', '', '', '', '', '', '', ''],
    ['Employee ID', 'First Name', 'Department', 'Date', 'Weekday', 'First Punch', 'Last Punch', 'Total Time'],
    // Nabil has a different biometric ID (77) and only First Name "نبيل"
    ['77', 'نبيل', 'Sales', '2026-11-22', 'Sun', '08:00', '16:00', '08:00'],
    ['77', 'نبيل', 'Sales', '2026-11-23', 'Mon', '08:02', '16:05', '08:03'],
    ['77', 'نبيل', 'Sales', '2026-11-24', 'Tue', '07:59', '16:01', '08:02'],
    ['77', 'نبيل', 'Sales', '2026-11-25', 'Wed', '08:04', '16:00', '07:56'],
    ['77', 'نبيل', 'Sales', '2026-11-26', 'Thu', '08:01', '', ''],
    // Omar has leading zeros "00105" vs directory "105"
    ['00105', 'عمر', 'IT', '2026-11-22', 'Sun', '08:00', '16:00', '08:00'],
  ];

  const { punches } = parseSpreadsheetMatrix(matrix);
  const { evaluations, unmappedCodes } = evaluateWeek(punches, '2026-11-22', dir, DEFAULT_SETTINGS);

  assert.equal(unmappedCodes.length, 0);
  // Strictly 2 rows — NO duplicate absent rows created!
  assert.equal(evaluations.length, 2);

  const nabil = evaluations.find((e) => e.empCode === '77')!;
  assert.equal(nabil.employeeName, 'نبيل أحمد الغامدي');
  assert.equal(nabil.phone, '٠٥٥٩٩٨٨٧٧٦');
  assert.equal(nabil.isCompliant, true);
  assert.ok(
    buildWhatsAppWebUrl(nabil.phone, 'مبروك', '966')?.startsWith(
      'https://web.whatsapp.com/send?phone=966559988776&text='
    )
  );

  const omar = evaluations.find((e) => e.empCode === '00105')!;
  assert.equal(omar.employeeName, 'عمر السبيعي');
  assert.equal(omar.phone, '0501112233');
});

test('resolveEvaluationsWithDirectory overlays directory phone onto previously uploaded evaluations', () => {
  const storedEval: EmployeeEvaluation = {
    id: 'ev_77',
    ownerId: 'demo',
    batchId: 'b1',
    empCode: '77',
    employeeName: 'نبيل',
    department: 'Sales',
    phone: '',
    email: '',
    isCompliant: true,
    lateDaysCount: 0,
    totalLateMinutes: 0,
    earlyLeaveMinutes: 0,
    missingPunchDays: 0,
    absentDays: 0,
    presentDays: 5,
    decision: 'reward',
    excusedDates: [],
    days: [],
    lastNotifiedAt: '',
    lastNotificationStatus: 'none',
    unmapped: true,
  };

  const dir: Employee[] = [
    {
      id: 'dir-nabil',
      ownerId: 'demo',
      empCode: '12',
      name: 'نبيل صالح',
      department: 'المبيعات',
      phone: '0551234567',
      email: 'nabil@company.sa',
      active: true,
    },
  ];

  const resolved = resolveEvaluationsWithDirectory([storedEval], dir);
  assert.equal(resolved[0].phone, '0551234567');
  assert.equal(resolved[0].email, 'nabil@company.sa');
  assert.equal(resolved[0].employeeName, 'نبيل صالح');
  assert.equal(resolved[0].unmapped, false);
});

test('groupEvaluationsByWorkflow splits employees cleanly into pending, ready, and sent groups', () => {
  const base: Omit<EmployeeEvaluation, 'id' | 'empCode' | 'decision' | 'lastNotificationStatus'> = {
    ownerId: 'demo',
    batchId: 'b1',
    employeeName: 'موظف',
    department: 'عام',
    phone: '0551234567',
    email: '',
    isCompliant: false,
    lateDaysCount: 1,
    totalLateMinutes: 20,
    earlyLeaveMinutes: 0,
    missingPunchDays: 0,
    absentDays: 0,
    presentDays: 5,
    excusedDates: [],
    days: [],
    lastNotifiedAt: '',
  };

  const list: EmployeeEvaluation[] = [
    { ...base, id: '1', empCode: '101', decision: 'pending', lastNotificationStatus: 'none' },
    { ...base, id: '2', empCode: '102', decision: 'reward', lastNotificationStatus: 'none' },
    { ...base, id: '3', empCode: '103', decision: 'allow_with_warning', lastNotificationStatus: 'failed' },
    { ...base, id: '4', empCode: '104', decision: 'deny_reward', lastNotificationStatus: 'sent' },
  ];

  const grouped = groupEvaluationsByWorkflow(list);
  assert.deepEqual(grouped.pending.map((e) => e.id), ['1']);
  assert.deepEqual(grouped.ready.map((e) => e.id), ['2', '3']);
  assert.deepEqual(grouped.sent.map((e) => e.id), ['4']);
  assert.equal(
    grouped.pending.length + grouped.ready.length + grouped.sent.length,
    list.length
  );
});

