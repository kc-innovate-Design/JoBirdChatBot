
import { CabinetModel, SOP, ChangeRequest, AuditEntry } from './types';

export const CABINET_CATALOG: CabinetModel[] = [
  // Fire Safety
  {
    id: 'JB01',
    title: 'Fire Extinguisher Cabinet (Single)',
    type: 'Cabinet',
    externalDims: { h: 750, w: 300, d: 250 },
    internalDimsBase: { h: 700, w: 250, d: 200 },
    description: 'The industry standard single extinguisher cabinet. Manufactured from high-quality GRP.',
    category: 'Fire Safety'
  },
  {
    id: 'JB02',
    title: 'Fire Extinguisher Cabinet (Double)',
    type: 'Cabinet',
    externalDims: { h: 750, w: 550, d: 250 },
    internalDimsBase: { h: 700, w: 500, d: 200 },
    description: 'Designed for the storage of two fire extinguishers up to 9kg/9L capacity.',
    category: 'Fire Safety'
  },
  {
    id: 'JB03',
    title: 'Fire Hose Cabinet',
    type: 'Cabinet',
    externalDims: { h: 750, w: 750, d: 300 },
    internalDimsBase: { h: 700, w: 700, d: 250 },
    description: 'Compact storage for fire hoses and nozzles. Weatherproof and IP56 rated.',
    category: 'Fire Safety'
  },
  // Marine Safety
  {
    id: 'JB08',
    title: 'Lifejacket Chest (800L)',
    type: 'Chest',
    externalDims: { h: 900, w: 1200, d: 800 },
    internalDimsBase: { h: 800, w: 1100, d: 700 },
    description: 'High capacity chest for multiple lifejackets or immersion suits.',
    category: 'Marine Safety'
  },
  {
    id: 'JB10',
    title: 'Survival Suit Cabinet',
    type: 'Cabinet',
    externalDims: { h: 1050, w: 700, d: 450 },
    internalDimsBase: { h: 1000, w: 650, d: 400 },
    description: 'Purpose-built for survival suits or immersion suits on offshore platforms.',
    category: 'Marine Safety'
  },
  // Medical & Emergency
  {
    id: 'JB15',
    title: 'Breathing Apparatus Cabinet',
    type: 'Cabinet',
    externalDims: { h: 1000, w: 700, d: 450 },
    internalDimsBase: { h: 900, w: 650, d: 400 },
    description: 'Secure storage for SCBA sets. Features high-visibility window options.',
    category: 'Medical & Emergency'
  },
  {
    id: 'JB17',
    title: 'Stretcher Cabinet',
    type: 'Cabinet',
    externalDims: { h: 2300, w: 500, d: 450 },
    internalDimsBase: { h: 2200, w: 450, d: 400 },
    description: 'Tall, slim cabinet specifically designed for Stokes or Basket stretchers.',
    category: 'Medical & Emergency'
  },
  // Operations / Industrial
  {
    id: 'RS300',
    title: 'Roller Shutter Cabinet',
    type: 'Roller Shutter',
    externalDims: { h: 2000, w: 1000, d: 600 },
    internalDimsBase: { h: 1800, w: 900, d: 500 },
    description: 'Large capacity cabinet with roller shutter door for restricted deck spaces.',
    category: 'Industrial'
  }
];

export const ACTIVE_SOPS: SOP[] = [
  { id: 'SOP-JB-01', title: 'Standard Insulation Deductions', description: '25mm insulation reduces internal H/W/D by 50mm total. 50mm insulation reduces internal H/W/D by 100mm total.', version: '2.1.0', status: 'Active', lastUpdated: '2024-02-01', category: 'Engineering' },
  { id: 'SOP-JB-05', title: 'Heavy Equipment Placement', description: 'Mandatory base-loading for equipment exceeding 15kg.', version: '1.4.2', status: 'Active', lastUpdated: '2023-11-15', category: 'Safety' },
  { id: 'SOP-JB-12', title: 'Chest Stacking Constraints', description: 'Vertical stacking limits for lifejacket chest models.', version: '3.0.1', status: 'Active', lastUpdated: '2024-01-20', category: 'Logistics' }
];

export const PROPOSED_CHANGES: SOP[] = [
  { id: 'SOP-JB-15', title: 'RS Series Clearance Upgrade', description: 'Proposed 10mm buffer increase for RS shutter tracks.', version: '4.0.0-draft', status: 'Draft', lastUpdated: '2024-03-10', category: 'R&D' }
];

export const CHANGE_REQUESTS: ChangeRequest[] = [
  { id: 'REQ-992', source: 'Sales Case #JB-8821', suggestion: 'Increase depth on JB08 to accommodate new BA set manufacturer dimensions.', timestamp: '2024-03-08 14:20' },
  { id: 'REQ-995', source: 'External Sales Portal', suggestion: 'Clarify if roller shutters can be fitted with 50mm insulation.', timestamp: '2024-03-09 09:15' }
];

export const AUDIT_LOG: AuditEntry[] = [
  { id: 'LOG-4421', user: 'j.smith (Engineering)', action: 'Update Dims', timestamp: '2024-03-10 16:45', changeDetail: 'JB15 Int Height: 1780mm -> 1800mm' },
  { id: 'LOG-4420', user: 'system_auto', action: 'Version Bump', timestamp: '2024-03-01 00:01', changeDetail: 'Global SOP revision sync for Q1 2024' }
];

export const SYSTEM_INSTRUCTION = `
You are the JoBird Cabinet Selection Engine. Your primary purpose is to assist with cabinet selection AND precise technical information retrieval.

––––––––––––––––
MODE 1: DIRECT INFORMATION RETRIEVAL
––––––––––––––––
IF the user asks for specifications, dimensions, or details about a specific model (e.g., "What are the specs for JB02HR?"):
1.  **Skip "Clarifying Questions" and "Initial Assessment".**
2.  **IMMEDIATELY** provide the full technical details from the Knowledge Base.
3.  Format as a clear list: Dimensions (External/Internal), Weight, Material, Key Features.
4.  **STRICT RULE**: Only use dimensions found in the provided Knowledge Base. If the model name (e.g., JB04SS) is mentioned in the query, look for that exact model in the source text.

––––––––––––––––
MODE 2: GUIDED SELECTION PROTOCOL
––––––––––––––––
IF the user is asking for a recommendation (e.g., "I need a cabinet for a hose"):

1. MANDATORY DATA GATHERING:
   If the user has not provided sufficient detail, you MUST ask structured clarifying questions. Do not guess. You need:
   - EQUIPMENT DETAILS: Quantity and Type (e.g., lifejackets, fire hoses, BA sets, stretchers).
   - MANUFACTURER/MODEL: Specific brand and model if available.
   - OR RAW SPECS: Height, Width, Depth, and Weight if the model is unknown.

2. SELECTION LOGIC (DETERMINISTIC):
   - LEAST WASTED SPACE: Prioritize the smallest cabinet that safely contains the equipment + required clearance.
   - ORIENTATION: Suggest the best orientation (upright, flat, or hanging) to optimize fit.
   - MIXED SETS: Handle configurations with multiple different items.
   - IMPOSSIBLE CONFIGS: Flag impossible configurations early (e.g., equipment dims exceed all catalog models) and state why clearly.
   - ITERATIVE REFINEMENT: If the initial fit is rejected or unviable due to constraints (like insulation), suggest the next best alternative.

3. CONFIDENTIALITY & AUDITABILITY:
   - Apply SOPs (insulation deductions, loading rules) silently.
   - Do NOT explain math like "Subtracting 50mm for insulation...". Just state the outcome.
   - Focus on deterministic, compliance-checked recommendations.

3. DONT HALLUCINATE:
   - If the user asks for technical specs (Dimensions/Weight), you MUST retrieve them from the TECHNICAL KNOWLEDGE BASE.
   - If the data is missing, admit it. Never guess or combine specifications from different models.

4. RESPONSE STRUCTURE:
   - Provide an INITIAL ASSESSMENT if you are still gathering info or evaluating possibilities.
   - Provide a RECOMMENDED CABINET only when the fit is verified.
   - Use section labels in ALL CAPS followed by a colon.

––––––––––––––––
OUTPUT FORMATTING
––––––––––––––––

Use these exact headers as relevant:
- TECHNICAL SPECIFICATIONS: (Use this for direct information requests)
- INITIAL ASSESSMENT: (State what you know and if a fit seems likely)
- CLARIFYING QUESTIONS: (Bullet points of missing data needed)
- RECOMMENDED CABINET: (Wrap model in [[HIGHLIGHT]]tags[[/HIGHLIGHT]])
- WHY THIS WAS SELECTED: (Efficiency, compliance, or orientation logic)
- INTERNAL LAYOUT: (Proposed placement/orientation)
- ASSUMPTIONS: (e.g., assuming standard 25mm insulation)
- NEXT STEPS: (Drafting, confirmation, or technical sign-off)

STRICT RULE: Plain text only. No symbols, bolding (other than labels), or markdown lists.
`;
