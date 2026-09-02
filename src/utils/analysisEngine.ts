import { BackOrderItem, WorkOrder, ConflictStatus, UrgencyLevel, ItemAnalysisSummary, MainExtractItem } from '../types';
import { ensureDate, parseFlexibleDate } from './csvParser';

// Reference date for simulation / evaluation (defaults to current date if not forced)
const CURRENT_SIMULATION_DATE = new Date('2026-08-06');

/**
 * Normalizes location strings to improve matching between Backorders and Main Extract
 * (e.g. "Sydney - MAXTRAX" -> base "Sydney")
 */
function normalizeLocKey(loc: string | undefined): { full: string; base: string } {
  if (!loc) return { full: '', base: '' };
  const cleaned = loc.trim().toUpperCase();
  const base = cleaned.split('-')[0].trim();
  return { full: cleaned, base };
}

/**
 * Calculates Urgency Level, Conflict Status, and Obsolete Classification for each back order item
 */
export function analyzeBackOrders(
  rawItems: Partial<BackOrderItem>[],
  workOrders: WorkOrder[],
  arg3?: Date | MainExtractItem[] | null,
  arg4?: MainExtractItem[] | Date | null
): BackOrderItem[] {
  let referenceDate: Date = CURRENT_SIMULATION_DATE;
  let mainExtractItems: MainExtractItem[] = [];

  // Flexibly handle argument order whether caller passes (raw, wo, mainExtract) or (raw, wo, refDate, mainExtract)
  if (Array.isArray(arg3)) {
    mainExtractItems = arg3;
    if (arg4 instanceof Date) {
      referenceDate = arg4;
    }
  } else if (arg3 instanceof Date) {
    referenceDate = arg3;
    if (Array.isArray(arg4)) {
      mainExtractItems = arg4;
    }
  } else if (Array.isArray(arg4)) {
    mainExtractItems = arg4;
  } else if (arg4 instanceof Date) {
    referenceDate = arg4;
  }

  // Ensure referenceDate is a valid Date object
  const safeRefDate =
    referenceDate && typeof referenceDate.getTime === 'function' && !isNaN(referenceDate.getTime())
      ? referenceDate
      : CURRENT_SIMULATION_DATE;

  // Map of work orders grouped by item SKU
  const woMap = new Map<string, WorkOrder[]>();
  for (const wo of workOrders) {
    const sku = wo.item.trim().toUpperCase();
    if (!woMap.has(sku)) woMap.set(sku, []);
    woMap.get(sku)!.push(wo);
  }

  // Build high-precision (Location + Product) lookup maps from Main Extract
  const exactLocProdMap = new Map<string, MainExtractItem>();
  const baseLocProdMap = new Map<string, MainExtractItem>();
  const prodOnlyMap = new Map<string, MainExtractItem>();

  for (const ext of mainExtractItems) {
    const pKey = ext.product.trim().toUpperCase();
    const { full: fullLoc, base: baseLoc } = normalizeLocKey(ext.location);

    exactLocProdMap.set(`${fullLoc}::${pKey}`, ext);
    if (!baseLocProdMap.has(`${baseLoc}::${pKey}`)) {
      baseLocProdMap.set(`${baseLoc}::${pKey}`, ext);
    }
    if (!prodOnlyMap.has(pKey)) {
      prodOnlyMap.set(pKey, ext);
    }
  }

  const todayMs = safeRefDate.getTime();

  return rawItems.map((raw, index) => {
    const itemSku = raw.item?.trim().toUpperCase() || 'UNKNOWN';
    const rawLoc = raw.location || '';
    const { full: itemFullLoc, base: itemBaseLoc } = normalizeLocKey(rawLoc);

    // Cross-reference location and product to find Main Extract classification
    const matchedExtract = 
      exactLocProdMap.get(`${itemFullLoc}::${itemSku}`) ||
      baseLocProdMap.get(`${itemBaseLoc}::${itemSku}`) ||
      prodOnlyMap.get(itemSku);

    const isObsolete = matchedExtract ? matchedExtract.isObsolete : !!raw.isObsolete;
    const classificationCode = matchedExtract?.classification || raw.classificationCode || '';
    const classificationName = matchedExtract?.classificationName || (isObsolete ? 'Obsolete' : 'Stocked');
    const supplyRisk = matchedExtract?.supplyRisk || raw.supplyRisk || (isObsolete ? 'Obsolete' : 'Stocked');
    const productDesc = matchedExtract?.description || raw.productDescription || '';
    const stockOnHand = matchedExtract?.stockOnHand ?? raw.stockOnHand ?? 0;
    const itemCategory = matchedExtract?.itemCategory || raw.itemCategory || '';

    const reqDate = ensureDate(raw.supplyRequiredDateParsed) || parseFlexibleDate(raw.supplyRequiredByDate);
    const value = raw.backOrderValueExGst || 0;
    const isNonInv = !!raw.isShippingOrNonInventory;

    // 1. Calculate Urgency
    let urgency: UrgencyLevel = 'LOW';
    let urgencyReason = 'Standard supply timeline';

    if (isObsolete) {
      urgency = 'CRITICAL';
      urgencyReason = `🚨 OBSOLETE PRODUCT (${classificationCode || 'XX'}) at ${rawLoc || 'Facility'} — Cancel Sales Order Required`;
    } else if (isNonInv) {
      urgency = 'LOW';
      urgencyReason = 'Shipping / Non-inventory line';
    } else if (reqDate) {
      const diffDays = Math.ceil((reqDate.getTime() - todayMs) / (1000 * 60 * 60 * 24));
      
      if (diffDays < 0) {
        urgency = 'CRITICAL';
        urgencyReason = `OVERDUE by ${Math.abs(diffDays)} day(s)! Required by ${raw.supplyRequiredByDate}`;
      } else if (diffDays <= 14) {
        urgency = 'CRITICAL';
        urgencyReason = `Due imminently in ${diffDays} day(s) (${raw.supplyRequiredByDate})`;
      } else if (diffDays <= 30) {
        urgency = 'HIGH';
        urgencyReason = `Due within 30 days (${diffDays} days away)`;
      } else if (diffDays <= 60) {
        urgency = 'MEDIUM';
        urgencyReason = `Due within 60 days (${diffDays} days away)`;
      } else {
        urgency = 'LOW';
        urgencyReason = `Required far in future (${diffDays} days away)`;
      }
    }

    // High value boost (only if not already critical)
    if (!isObsolete && !isNonInv && value >= 50000) {
      urgency = 'CRITICAL';
      urgencyReason += ` | High Value Order ($${value.toLocaleString('en-AU', { minimumFractionDigits: 2 })})`;
    } else if (!isObsolete && !isNonInv && value >= 15000 && urgency === 'LOW') {
      urgency = 'MEDIUM';
      urgencyReason += ` | Significant Value ($${value.toLocaleString('en-AU', { minimumFractionDigits: 2 })})`;
    }

    // 2. Evaluate Work Order Conflicts
    let conflictStatus: ConflictStatus = 'EXEMPT';
    let conflictDetails = 'Non-inventory or shipping item';

    if (isObsolete) {
      conflictStatus = 'OBSOLETE';
      conflictDetails = `🛑 Product is classified as OBSOLETE (Code: ${classificationCode || 'XX'}) at ${rawLoc}. Stock: ${stockOnHand} available. No production possible. Action: Cancel Sales Order ${raw.documentNumber || 'SO'}.`;
    } else if (!isNonInv) {
      const matchingWos = woMap.get(itemSku) || [];

      if (matchingWos.length === 0) {
        conflictStatus = 'NO_WORK_ORDER';
        conflictDetails = '⚠️ NO work orders scheduled in system for this part!';
      } else {
        // Total WO Qty scheduled
        const totalWoQty = matchingWos.reduce((sum, wo) => sum + wo.scheduledQty, 0);
        
        // Find earliest completion date among non-completed WOs
        const validWos = matchingWos.filter(w => w.status !== 'Completed');
        const activeWos = validWos.length > 0 ? validWos : matchingWos;
        
        const sortedWos = [...activeWos].sort((a, b) => {
          const dateA = ensureDate(a.scheduledDateParsed) || parseFlexibleDate(a.scheduledDate);
          const dateB = ensureDate(b.scheduledDateParsed) || parseFlexibleDate(b.scheduledDate);
          const dA = dateA ? dateA.getTime() : Infinity;
          const dB = dateB ? dateB.getTime() : Infinity;
          return dA - dB;
        });

        const earliestWo = sortedWos[0];
        const earliestWoDate = earliestWo ? (ensureDate(earliestWo.scheduledDateParsed) || parseFlexibleDate(earliestWo.scheduledDate)) : null;
        const boQty = raw.backOrderQty || 0;

        if (reqDate && earliestWo && earliestWoDate) {
          if (earliestWoDate.getTime() > reqDate.getTime()) {
            conflictStatus = 'SCHEDULE_CONFLICT';
            const lagDays = Math.ceil((earliestWoDate.getTime() - reqDate.getTime()) / (1000 * 60 * 60 * 24));
            conflictDetails = `🔴 Earliest WO (${earliestWo.woNumber}) finishes on ${earliestWo.scheduledDate}, which is ${lagDays} day(s) AFTER required date (${raw.supplyRequiredByDate})`;
          } else if (totalWoQty < boQty) {
            conflictStatus = 'QUANTITY_SHORTAGE';
            conflictDetails = `⚠️ Scheduled WO Qty (${totalWoQty}) is less than Back Order Qty required (${boQty}). Shortage of ${boQty - totalWoQty} units.`;
          } else {
            conflictStatus = 'COVERED';
            conflictDetails = `🟢 Scheduled WO (${earliestWo.woNumber}) on ${earliestWo.scheduledDate} covers ${totalWoQty} units (BO: ${boQty})`;
          }
        } else if (totalWoQty < boQty) {
          conflictStatus = 'QUANTITY_SHORTAGE';
          conflictDetails = `⚠️ Scheduled WO Qty (${totalWoQty}) is less than Back Order Qty required (${boQty})`;
        } else {
          conflictStatus = 'COVERED';
          conflictDetails = `🟢 ${matchingWos.length} WO(s) scheduled covering ${totalWoQty} units`;
        }
      }
    }

    return {
      id: raw.id || `bo-${index}`,
      item: raw.item || 'UNKNOWN',
      backOrderQty: raw.backOrderQty || 0,
      supplyRequiredByDate: raw.supplyRequiredByDate || 'N/A',
      supplyRequiredDateParsed: reqDate,
      documentNumber: raw.documentNumber || '',
      status: raw.status || '',
      expectedShipDate: raw.expectedShipDate || '',
      estimateStockAvailableDate: raw.estimateStockAvailableDate || '',
      customerPo: raw.customerPo || '',
      dateCreated: raw.dateCreated || '',
      quantity: raw.quantity || 0,
      qtyShipped: raw.qtyShipped || 0,
      backOrderValueExGst: value,
      commit: raw.commit || '',
      location: rawLoc,
      customerName: raw.customerName || 'Unknown Customer',
      classCategory: raw.classCategory || '',
      brand: raw.brand || 'Unbranded',
      typeCategory: raw.typeCategory || '',
      inventoryType: raw.inventoryType || '',
      isObsolete,
      classificationCode,
      classificationName,
      supplyRisk,
      productDescription: productDesc,
      stockOnHand,
      itemCategory,
      cancellationStatus: raw.cancellationStatus || (isObsolete ? 'PENDING' : undefined),
      cancellationDate: raw.cancellationDate,
      cancellationNotes: raw.cancellationNotes,
      urgency,
      urgencyReason,
      conflictStatus,
      conflictDetails,
      isShippingOrNonInventory: isNonInv
    };
  });
}

/**
 * Computes high-level metrics and aggregate breakdowns including obsolete items
 */
export function generateAnalysisSummary(items: BackOrderItem[]): ItemAnalysisSummary {
  const invItems = items.filter(i => !i.isShippingOrNonInventory);

  let totalBackorderQty = 0;
  let totalBackorderValue = 0;
  let criticalCount = 0;
  let highCount = 0;
  let noWorkOrderCount = 0;
  let scheduleConflictCount = 0;
  let qtyShortageCount = 0;
  let coveredCount = 0;
  let obsoleteCount = 0;
  let obsoleteValue = 0;
  let obsoletePendingCancelCount = 0;

  const brandDist: Record<string, { count: number; value: number }> = {};
  const customerMap = new Map<string, { orderCount: number; totalValue: number; criticalCount: number }>();

  invItems.forEach(item => {
    totalBackorderQty += item.backOrderQty;
    totalBackorderValue += item.backOrderValueExGst;

    if (item.urgency === 'CRITICAL') criticalCount++;
    if (item.urgency === 'HIGH') highCount++;

    if (item.isObsolete || item.conflictStatus === 'OBSOLETE') {
      obsoleteCount++;
      obsoleteValue += item.backOrderValueExGst;
      if (item.cancellationStatus !== 'CANCELLED') {
        obsoletePendingCancelCount++;
      }
    } else {
      if (item.conflictStatus === 'NO_WORK_ORDER') noWorkOrderCount++;
      if (item.conflictStatus === 'SCHEDULE_CONFLICT') scheduleConflictCount++;
      if (item.conflictStatus === 'QUANTITY_SHORTAGE') qtyShortageCount++;
      if (item.conflictStatus === 'COVERED') coveredCount++;
    }

    // Brand distribution
    const brand = item.brand.trim() || 'Other';
    if (!brandDist[brand]) {
      brandDist[brand] = { count: 0, value: 0 };
    }
    brandDist[brand].count++;
    brandDist[brand].value += item.backOrderValueExGst;

    // Customer map
    const cust = item.customerName.trim() || 'Unknown Customer';
    const existing = customerMap.get(cust) || { orderCount: 0, totalValue: 0, criticalCount: 0 };
    existing.orderCount++;
    existing.totalValue += item.backOrderValueExGst;
    if (item.urgency === 'CRITICAL') existing.criticalCount++;
    customerMap.set(cust, existing);
  });

  const customerImpact = Array.from(customerMap.entries())
    .map(([customerName, data]) => ({ customerName, ...data }))
    .sort((a, b) => b.totalValue - a.totalValue);

  return {
    totalItems: invItems.length,
    totalBackorderQty,
    totalBackorderValue,
    criticalCount,
    highCount,
    noWorkOrderCount,
    scheduleConflictCount,
    qtyShortageCount,
    coveredCount,
    obsoleteCount,
    obsoleteValue,
    obsoletePendingCancelCount,
    brandDistribution: brandDist,
    customerImpact
  };
}

