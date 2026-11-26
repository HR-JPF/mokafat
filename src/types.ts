export type ManagerDecision =
  | 'reward'
  | 'allow_same'
  | 'allow_with_warning'
  | 'deny_reward'
  | 'pending';

export type NotificationStatus = 'none' | 'sent' | 'failed' | 'partial';

export type DispatchChannel = 'whatsapp_api' | 'whatsapp_web' | 'email';

export type DayStatus =
  | 'on_time'
  | 'late'
  | 'early_leave'
  | 'missing_punch'
  | 'absent'
  | 'excused';

export interface Employee {
  id: string;
  ownerId: string;
  empCode: string;
  name: string;
  department: string;
  phone: string;
  email: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RawPunch {
  empCode: string;
  timestamp: string; // YYYY-MM-DD HH:MM:SS
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  minutesFromMidnight: number;
  rawName?: string;
  rawDepartment?: string;
}

export interface DayPunchSummary {
  date: string; // YYYY-MM-DD
  dayNameAr: string;
  dayIndex: number; // 0 = Sun ... 4 = Thu
  firstIn: string | null; // HH:MM
  lastOut: string | null; // HH:MM
  punchCount: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  missingPunch: boolean;
  absent: boolean;
  excused: boolean;
  status: DayStatus;
}

export interface EmployeeEvaluation {
  id: string;
  ownerId: string;
  batchId: string;
  empCode: string;
  employeeName: string;
  department: string;
  phone: string;
  email: string;
  isCompliant: boolean;
  lateDaysCount: number;
  totalLateMinutes: number;
  earlyLeaveMinutes: number;
  missingPunchDays: number;
  absentDays: number;
  presentDays: number;
  decision: ManagerDecision;
  excusedDates: string[];
  days: DayPunchSummary[];
  lastNotifiedAt: string;
  lastNotificationStatus: NotificationStatus;
  unmapped?: boolean;
}

export interface WeeklyBatch {
  id: string;
  ownerId: string;
  weekKey: string; // Sunday YYYY-MM-DD
  weekLabel: string;
  fileName: string;
  totalEmployees: number;
  compliantCount: number;
  nonCompliantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  ownerId: string;
  batchId: string;
  weekKey: string;
  weekLabel: string;
  empCode: string;
  employeeName: string;
  recipient: string;
  decision: Exclude<ManagerDecision, 'pending'>;
  channel: DispatchChannel;
  status: 'sent' | 'failed' | 'pending';
  messagePreview: string;
  errorMessage: string;
  sentByEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  workStartTime: string; // HH:MM
  workEndTime: string; // HH:MM
  graceLateMinutes: number;
  graceEarlyMinutes: number;
  maxLateDaysAllowed: number;
  maxTotalLateMinutes: number;
  thursdayMorningOnly: boolean;
  countMissingPunchAsNonCompliant: boolean;
  countAbsenceAsNonCompliant: boolean;
  whatsappMode: 'both' | 'api' | 'web';
  whatsappProvider: 'cloud_api' | 'ultramsg' | 'webhook';
  whatsappPhoneNumberId: string;
  whatsappInstanceId: string;
  whatsappWebhookUrl: string;
  defaultCountryCode: string;
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  emailFromName: string;
  emailFromAddress: string;
  emailSubject: string;
  templateReward: string;
  templateAllowWithWarning: string;
  templateDenyReward: string;
}

export interface ServerSecretsStatus {
  whatsappCloudConfigured: boolean;
  whatsappUltramsgConfigured: boolean;
  whatsappWebhookSecretConfigured: boolean;
  smtpPasswordConfigured: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  workStartTime: '08:00',
  workEndTime: '16:00',
  graceLateMinutes: 15,
  graceEarlyMinutes: 10,
  maxLateDaysAllowed: 0,
  maxTotalLateMinutes: 15,
  thursdayMorningOnly: true,
  countMissingPunchAsNonCompliant: true,
  countAbsenceAsNonCompliant: true,
  whatsappMode: 'both',
  whatsappProvider: 'cloud_api',
  whatsappPhoneNumberId: '',
  whatsappInstanceId: '',
  whatsappWebhookUrl: '',
  defaultCountryCode: '966',
  emailEnabled: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  emailFromName: 'إدارة الموارد البشرية — نظام انضباط',
  emailFromAddress: '',
  emailSubject: 'إشعار المكافأة الأسبوعية للالتزام بالدوام — {الأسبوع}',
  templateReward:
    'السلام عليكم {الاسم}، مبروك حصلت على المكافأة الأسبوعية لأسبوع ({الأسبوع})، بإمكانك الخروج اليوم من بعد الساعة ١٢ ظهراً في حال ما كان عندك أي مهام عمل. شكراً لالتزامك.',
  templateAllowWithWarning:
    'السلام عليكم {الاسم}، نود إشعارك بوجود تأخيرات وعدم انتظام خلال أسبوع ({الأسبوع}) بمجموع ({دقائق_التأخير} دقيقة / {أيام_التأخير} أيام)، ولكن تم السماح لك استثنائياً بالخروج اليوم من بعد الساعة ١٢ ظهراً في حال عدم وجود مهام عمل. نرجو الحرص على الالتزام بالدوام.',
  templateDenyReward:
    'السلام عليكم {الاسم}، للأسف بسبب التأخيرات وعدم الالتزام في العمل خلال أسبوع ({الأسبوع}) (تأخير {دقائق_التأخير} دقيقة، بصمات ناقصة: {البصمات_الناقصة}، غياب: {أيام_الغياب})، لن تحصل على مكافأة الخروج المبكر من العمل هذا الأسبوع. نتطلع لتحسن التزامك الأسبوع القادم.',
};

export const DECISION_LABELS: Record<ManagerDecision, string> = {
  reward: 'مكافأة الخروج المبكر (ملتزم)',
  allow_same: 'السماح بنفس رسالة المكافأة',
  allow_with_warning: 'سماح استثنائي مع تنبيه بالالتزام',
  deny_reward: 'عدم منح مكافأة الخروج المبكر',
  pending: 'بانتظار قرار المدير',
};

export const CHANNEL_LABELS: Record<DispatchChannel, string> = {
  whatsapp_api: 'واتساب API',
  whatsapp_web: 'واتساب ويب',
  email: 'بريد إلكتروني',
};

export type UserRole = 'super_admin' | 'hr_manager' | 'supervisor' | 'viewer';

export type PermissionKey =
  | 'uploadAttendance'
  | 'manageDecisions'
  | 'sendNotifications'
  | 'manageEmployees'
  | 'viewLogs'
  | 'exportReports'
  | 'manageSettings'
  | 'manageUsers';

export type UserPermissions = Record<PermissionKey, boolean>;

export interface AppUserAccount {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  permissions: UserPermissions;
  active: boolean;
  isEnvAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
}

