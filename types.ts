
export interface CabinetModel {
  id: string; // e.g., JB08
  title: string;
  type: 'Cabinet' | 'Chest' | 'Roller Shutter';
  externalDims: { h: number; w: number; d: number };
  internalDimsBase: { h: number; w: number; d: number }; // Dimensions without insulation
  description: string;
  category: string;
}

export interface EquipmentItem {
  type: string;
  qty: number;
  dims: { h: number; w: number; d: number };
  weight: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface SOP {
  id: string;
  title: string;
  description: string;
  version: string;
  status: 'Active' | 'Draft' | 'Deprecated';
  lastUpdated: string;
  category: string;
  replacesId?: string;
  changeReason?: string;
  proposedBy?: string;
}

export interface SalesFeedback {
  id: string;
  userId: string;
  timestamp: string;
  context: {
    cabinetId?: string;
    equipment?: string;
    insulation?: string;
    sopVersion?: string;
  };
  task: string;
  issue: string;
  urgency: 'Low' | 'Medium' | 'High';
}

export interface ChangeRequest {
  id: string;
  source: string; // e.g., "Sales Case #1024"
  suggestion: string;
  timestamp: string;
  linkedConfig?: string;
  urgency?: string;
}

export interface AuditEntry {
  id: string;
  user: string;
  action: string;
  timestamp: string;
  changeDetail: string;
}

export interface DatasheetReference {
  filename: string;
  displayName: string;
  productName?: string; // e.g. "2 x 30M Fire Hose cabinet"
}

export interface AIResponse {
  text: string;
  referencedDatasheets: DatasheetReference[];
}

export interface KnowledgeBaseStats {
  totalDatasheets: number;
  categoryMatches?: { category: string; count: number }[];
}
