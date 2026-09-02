import { BackOrderItem, WorkOrder, MainExtractItem } from '../types';

/**
 * Parses a raw CSV string into an array of string arrays (rows and cells).
 * Correctly handles quoted values containing commas or newlines.
 */
export function parseCsvRaw(csvText: string): string[][] {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip \n after \r
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(cell => cell.length > 0)) {
      lines.push(currentRow);
    }
  }

  return lines;
}

/**
 * Parses Australian or ISO date strings (e.g. 19/10/2026, 2026-10-19, 25/4/2025 4:43 PM)
 */
export function parseFlexibleDate(dateStr: string | undefined): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const cleanStr = dateStr.trim().split(' ')[0]; // Remove time if present

  // DD/MM/YYYY or D/M/YYYY format
  const dmyMatch = cleanStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // YYYY-MM-DD format
  const ymdMatch = cleanStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  const fallback = new Date(cleanStr);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Ensures a value is converted safely to a valid Date object or null.
 * Handles Date instances, ISO date strings, timestamp strings, numbers, or custom string formats.
 */
export function ensureDate(dateVal: any): Date | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    return isNaN(dateVal.getTime()) ? null : dateVal;
  }
  if (typeof dateVal === 'string' || typeof dateVal === 'number') {
    const parsed = new Date(dateVal);
    if (!isNaN(parsed.getTime())) return parsed;
    return parseFlexibleDate(String(dateVal));
  }
  return null;
}

/**
 * Formats a Date object to DD/MM/YYYY string
 */
export function formatDateDMY(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return 'N/A';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Parses Back Order CSV text into raw records
 */
export function parseBackOrderCsv(csvText: string): Partial<BackOrderItem>[] {
  const rows = parseCsvRaw(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.replace(/^\ufeff/, '').trim().toLowerCase());
  
  const getIndex = (possibleNames: string[]) => {
    return headers.findIndex(h => possibleNames.includes(h));
  };

  const idxItem = getIndex(['item', 'sku', 'part number', 'part']);
  const idxBoQty = getIndex(['back order qty', 'backorder qty', 'bo qty', 'back order quantity']);
  const idxSupplyDate = getIndex(['supply required by date', 'required date', 'supply date', 'needed by']);
  const idxDocNum = getIndex(['document number', 'so number', 'order #', 'sales order']);
  const idxStatus = getIndex(['status', 'order status']);
  const idxExpShipDate = getIndex(['expected ship date', 'ship date']);
  const idxEstStockDate = getIndex(['estimate stock available date', 'stock available date']);
  const idxCustomerPo = getIndex(['customer po#', 'customer po', 'po number']);
  const idxDateCreated = getIndex(['date created', 'order date', 'created date']);
  const idxQuantity = getIndex(['quantity', 'total qty', 'order qty']);
  const idxQtyShipped = getIndex(['qty shipped', 'shipped qty']);
  const idxValue = getIndex(['back order order value (ext ex gst)', 'back order value', 'ext value', 'value ex gst', 'value']);
  const idxCommit = getIndex(['commit']);
  const idxLocation = getIndex(['location', 'warehouse']);
  const idxCustomer = getIndex(['customer name', 'customer']);
  const idxClass = getIndex(['class']);
  const idxBrand = getIndex(['brand']);
  const idxType = getIndex(['type']);
  const idxInventoryType = getIndex(['inventory type']);

  // If we can't find any core backorder indicators, treat it as invalid
  if (idxItem === -1 && idxBoQty === -1 && idxDocNum === -1) {
    return [];
  }

  const items: Partial<BackOrderItem>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || !row.some(c => c.trim().length > 0)) continue;

    const itemSku = idxItem >= 0 ? row[idxItem] || '' : row[0] || '';
    if (!itemSku.trim()) continue;

    const rawValue = idxValue >= 0 ? row[idxValue] || '0' : '0';
    const numValue = parseFloat(rawValue.replace(/[\$,]/g, '')) || 0;

    const rawBoQty = idxBoQty >= 0 ? row[idxBoQty] || '0' : '0';
    const numBoQty = parseFloat(rawBoQty.replace(/[,]/g, '')) || 0;

    const rawQty = idxQuantity >= 0 ? row[idxQuantity] || '0' : '0';
    const numQty = parseFloat(rawQty.replace(/[,]/g, '')) || 0;

    const rawQtyShipped = idxQtyShipped >= 0 ? row[idxQtyShipped] || '0' : '0';
    const numQtyShipped = parseFloat(rawQtyShipped.replace(/[,]/g, '')) || 0;

    const supplyRequiredByDate = idxSupplyDate >= 0 ? row[idxSupplyDate] || '' : '';
    const parsedSupplyDate = parseFlexibleDate(supplyRequiredByDate);

    const typeCat = idxType >= 0 ? row[idxType] || '' : '';
    const invType = idxInventoryType >= 0 ? row[idxInventoryType] || '' : '';
    
    // Check if non-inventory / shipping cost line
    const isShippingOrNonInventory = 
      typeCat.toLowerCase().includes('shipping cost') ||
      invType.toLowerCase().includes('non inventory') ||
      itemSku.toLowerCase().includes('shipping') ||
      itemSku.toLowerCase().includes('parcel post') ||
      itemSku.toLowerCase().includes('border express') ||
      itemSku.toLowerCase().includes('discount') ||
      itemSku.toLowerCase().includes('delivery au') ||
      itemSku.toLowerCase().includes('opening balance');

    items.push({
      id: `bo-${i}-${itemSku}`,
      item: itemSku,
      backOrderQty: numBoQty,
      supplyRequiredByDate: supplyRequiredByDate,
      supplyRequiredDateParsed: parsedSupplyDate,
      documentNumber: idxDocNum >= 0 ? row[idxDocNum] || '' : '',
      status: idxStatus >= 0 ? row[idxStatus] || '' : '',
      expectedShipDate: idxExpShipDate >= 0 ? row[idxExpShipDate] || '' : '',
      estimateStockAvailableDate: idxEstStockDate >= 0 ? row[idxEstStockDate] || '' : '',
      customerPo: idxCustomerPo >= 0 ? row[idxCustomerPo] || '' : '',
      dateCreated: idxDateCreated >= 0 ? row[idxDateCreated] || '' : '',
      quantity: numQty,
      qtyShipped: numQtyShipped,
      backOrderValueExGst: numValue,
      commit: idxCommit >= 0 ? row[idxCommit] || '' : '',
      location: idxLocation >= 0 ? row[idxLocation] || '' : '',
      customerName: idxCustomer >= 0 ? row[idxCustomer] || '' : '',
      classCategory: idxClass >= 0 ? row[idxClass] || '' : '',
      brand: idxBrand >= 0 ? row[idxBrand] || '' : '',
      typeCategory: typeCat,
      inventoryType: invType,
      isShippingOrNonInventory
    });
  }

  return items;
}

/**
 * Parses Work Order CSV text into structured WorkOrder records
 */
export function parseWorkOrderCsv(csvText: string): WorkOrder[] {
  const rows = parseCsvRaw(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.replace(/^\ufeff/, '').trim().toLowerCase());
  
  const getIndex = (possibleNames: string[]) => {
    return headers.findIndex(h => possibleNames.includes(h));
  };

  const idxWoNum = getIndex(['wo #', 'wo number', 'work order', 'wo#', 'work order number', 'wo']);
  const idxItem = getIndex(['part #', 'part number', 'part', 'item', 'sku']);
  const idxQty = getIndex(['qty', 'scheduled quantity', 'quantity', 'scheduled qty', 'target qty']);
  const idxDate = getIndex(['end date', 'scheduled completion date', 'completion date', 'due date', 'scheduled date', 'start date', 'date']);
  const idxStatus = getIndex(['status', 'wo status']);
  const idxWorkCenter = getIndex(['work center', 'line', 'assembly line', 'location']);
  const idxNotes = getIndex(['description', 'notes', 'comments', 'memo', 'traveler memo']);

  // If we can't find core work order indicators, treat it as invalid
  if (idxWoNum === -1 && idxItem === -1 && idxQty === -1) {
    return [];
  }

  const workOrders: WorkOrder[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || !row.some(c => c.trim().length > 0)) continue;

    const itemSku = idxItem >= 0 ? row[idxItem] || '' : row[0] || '';
    if (!itemSku.trim()) continue;

    const woNum = idxWoNum >= 0 ? row[idxWoNum] || `WO-${1000 + i}` : `WO-${1000 + i}`;
    const rawQty = idxQty >= 0 ? row[idxQty] || '0' : '0';
    const numQty = parseFloat(rawQty.replace(/[,]/g, '')) || 0;

    const rawDate = idxDate >= 0 ? row[idxDate] || '' : '';
    const dateParsed = parseFlexibleDate(rawDate);

    const rawStatus = idxStatus >= 0 ? row[idxStatus] || 'Planned' : 'Planned';
    let status: WorkOrder['status'] = 'Planned';
    if (rawStatus.toLowerCase().includes('progress')) status = 'In Progress';
    else if (rawStatus.toLowerCase().includes('plan')) status = 'Planned';
    else if (rawStatus.toLowerCase().includes('complete')) status = 'Completed';
    else if (rawStatus.toLowerCase().includes('release')) status = 'Released';
    else if (rawStatus.toLowerCase().includes('delay')) status = 'Delayed';

    workOrders.push({
      id: `wo-${i}-${woNum}`,
      woNumber: woNum,
      item: itemSku,
      scheduledQty: numQty,
      scheduledDate: rawDate,
      scheduledDateParsed: dateParsed,
      status: status,
      workCenter: idxWorkCenter >= 0 ? row[idxWorkCenter] || 'Assembly Line 1' : 'Assembly Line 1',
      notes: idxNotes >= 0 ? row[idxNotes] || '' : ''
    });
  }

  return workOrders;
}

/**
 * Parses Main Extract CSV text (Item Master, Inventory & Classification dataset)
 * Matching the columns from user prompt screenshot:
 * id, location, product, descriptio, supplier, supply_risk, classifica, type, class, item_categ, special_cl, unit_cost, selling_pr, purchase_unit_volume, unit_weight, stock_on_hand, days_on_hand, avg_sales, month_co, allocated, cust_orde, purch_ord, status
 */
export function parseMainExtractCsv(csvText: string): MainExtractItem[] {
  const rows = parseCsvRaw(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.replace(/^\ufeff/, '').trim().toLowerCase());

  const getIndex = (possibleNames: string[]) => {
    return headers.findIndex(h => possibleNames.some(name => h === name.toLowerCase() || h.includes(name.toLowerCase())));
  };

  const idIdx = getIndex(['id', 'record_id']);
  const locIdx = getIndex(['location', 'loc', 'warehouse', 'site']);
  const prodIdx = getIndex(['product', 'item', 'sku', 'part #', 'part_number']);
  const descIdx = getIndex(['descriptio', 'description', 'desc', 'item_name']);
  const suppIdx = getIndex(['supplier', 'vendor']);
  const supplyRiskIdx = getIndex(['supply_risk', 'supply risk', 'risk']);
  const classCodeIdx = getIndex(['classifica', 'classification', 'class_code', 'abc']);
  const typeIdx = getIndex(['type', 'item_type']);
  const classCatIdx = getIndex(['class', 'class_category']);
  const itemCatIdx = getIndex(['item_categ', 'item category', 'category']);
  const specClassIdx = getIndex(['special_cl', 'special_classification']);
  const unitCostIdx = getIndex(['unit_cost', 'cost']);
  const sellingPriceIdx = getIndex(['selling_pr', 'selling_price', 'price']);
  const unitVolIdx = getIndex(['purchase_unit_volume', 'unit_volur']);
  const unitWeightIdx = getIndex(['unit_weight', 'unit_weigh']);
  const stockOnHandIdx = getIndex(['stock_on_hand', 'stock_on_', 'stock on hand', 'soh', 'on_hand']);
  const daysOnHandIdx = getIndex(['days_on_hand', 'days_on_']);
  const avgSalesIdx = getIndex(['avg_sales', 'average_sales']);
  const monthlyCompIdx = getIndex(['month_co', 'monthly_consumption']);
  const allocatedIdx = getIndex(['allocated', 'alloc']);
  const custOrdersIdx = getIndex(['cust_orde', 'cust_orders', 'customer_orders', 'sales_orders']);
  const purchOrdersIdx = getIndex(['purch_ord', 'purch_orders', 'purchase_orders']);
  const statusIdx = getIndex(['status', 'inventory_status']);

  return rows.slice(1).map((row, index) => {
    const rawId = (idIdx !== -1 ? row[idIdx] : '') || `ext-${index + 1}`;
    const location = (locIdx !== -1 ? row[locIdx] : '') || 'Unassigned';
    const product = (prodIdx !== -1 ? row[prodIdx] : '') || `PROD-${index + 1}`;
    const description = (descIdx !== -1 ? row[descIdx] : '') || '';
    const supplier = (suppIdx !== -1 ? row[suppIdx] : '') || '';
    const supplyRisk = (supplyRiskIdx !== -1 ? row[supplyRiskIdx] : '') || 'Stocked';
    const classification = (classCodeIdx !== -1 ? row[classCodeIdx] : '') || 'CL';
    const type = (typeIdx !== -1 ? row[typeIdx] : '') || 'Inventory';
    const classCategory = (classCatIdx !== -1 ? row[classCatIdx] : '') || '';
    const itemCategory = (itemCatIdx !== -1 ? row[itemCatIdx] : '') || '';
    const specialClassification = (specClassIdx !== -1 ? row[specClassIdx] : '') || '';
    
    const unitCost = unitCostIdx !== -1 ? parseFloat(row[unitCostIdx].replace(/[$,]/g, '')) || 0 : 0;
    const sellingPrice = sellingPriceIdx !== -1 ? parseFloat(row[sellingPriceIdx].replace(/[$,]/g, '')) || 0 : 0;
    const unitVolume = unitVolIdx !== -1 ? parseFloat(row[unitVolIdx]) || 0 : 0;
    const unitWeight = unitWeightIdx !== -1 ? parseFloat(row[unitWeightIdx]) || 0 : 0;
    const stockOnHand = stockOnHandIdx !== -1 ? parseFloat(row[stockOnHandIdx].replace(/,/g, '')) || 0 : 0;
    const daysOnHand = daysOnHandIdx !== -1 ? parseFloat(row[daysOnHandIdx].replace(/,/g, '')) || 0 : 0;
    const avgSales = avgSalesIdx !== -1 ? parseFloat(row[avgSalesIdx].replace(/,/g, '')) || 0 : 0;
    const monthlyConsumption = monthlyCompIdx !== -1 ? parseFloat(row[monthlyCompIdx].replace(/,/g, '')) || 0 : 0;
    const allocated = allocatedIdx !== -1 ? parseFloat(row[allocatedIdx].replace(/,/g, '')) || 0 : 0;
    const custOrders = custOrdersIdx !== -1 ? parseFloat(row[custOrdersIdx].replace(/,/g, '')) || 0 : 0;
    const purchOrders = purchOrdersIdx !== -1 ? parseFloat(row[purchOrdersIdx].replace(/,/g, '')) || 0 : 0;
    const status = (statusIdx !== -1 ? row[statusIdx] : '') || 'Ok';

    // Obsolete classification logic by location & product
    const supplyRiskLower = supplyRisk.trim().toLowerCase();
    const classCodeUpper = classification.trim().toUpperCase();
    const descUpper = description.trim().toUpperCase();
    const itemCatUpper = itemCategory.trim().toUpperCase();
    const statusLower = status.trim().toLowerCase();

    const isObsolete = 
      supplyRiskLower.includes('obsolete') ||
      classCodeUpper === 'XX' ||
      classCodeUpper.includes('OBS') ||
      descUpper.includes('END OF LIFE') ||
      descUpper.includes('EOL') ||
      descUpper.includes('OBSOLETE') ||
      itemCatUpper.includes('EOL') ||
      itemCatUpper.includes('OBSOLETE') ||
      statusLower.includes('obsolete');

    return {
      id: rawId,
      location,
      product,
      description,
      supplier,
      supplyRisk,
      classification,
      classificationName: isObsolete ? 'Obsolete' : supplyRisk || 'Stocked',
      type,
      classCategory,
      itemCategory,
      specialClassification,
      unitCost,
      sellingPrice,
      purchaseUnitVolume: unitVolume,
      unitWeight,
      stockOnHand,
      daysOnHand,
      avgSales,
      monthlyConsumption,
      allocated,
      custOrders,
      purchOrders,
      status,
      isObsolete
    };
  }).filter(item => item.product && item.product.trim().length > 0);
}

/**
 * Auto-detects whether a CSV string represents Main Extract, Backorder Report, or Work Orders dataset
 */
export function detectCsvType(csvText: string): { type: 'main_extract' | 'backorders' | 'workorders'; autoDetected: boolean } {
  if (!csvText.trim()) return { type: 'backorders', autoDetected: false };
  
  const rows = parseCsvRaw(csvText);
  if (rows.length < 1) return { type: 'backorders', autoDetected: false };

  const headers = rows[0].map(h => h.replace(/^\ufeff/, '').trim().toLowerCase());

  // Check for Main Extract
  const hasMainExtractIndicators = headers.some(h => 
    h.includes('supply_risk') || h.includes('classifica') || h.includes('stock_on_') || h.includes('cust_orde') || h.includes('purch_ord') || h.includes('item_categ') || h.includes('days_on_') || h.includes('month_co')
  );

  if (hasMainExtractIndicators) {
    return { type: 'main_extract', autoDetected: true };
  }

  const hasWoIndicators = headers.some(h => 
    h.includes('wo #') || h.includes('wo number') || h.includes('work order') || h.includes('work center') || h.includes('part #') || h.includes('traveler')
  );

  const hasBoIndicators = headers.some(h => 
    h.includes('back order') || h.includes('bo qty') || h.includes('supply required') || h.includes('document number') || h.includes('so number') || h.includes('inventory type')
  );

  if (hasWoIndicators && !hasBoIndicators) {
    return { type: 'workorders', autoDetected: true };
  }
  if (hasBoIndicators && !hasWoIndicators) {
    return { type: 'backorders', autoDetected: true };
  }

  // Fallback by testing parser output row count
  const mainParsedCount = parseMainExtractCsv(csvText).length;
  const boParsedCount = parseBackOrderCsv(csvText).length;
  const woParsedCount = parseWorkOrderCsv(csvText).length;

  if (mainParsedCount > boParsedCount && mainParsedCount > woParsedCount) {
    return { type: 'main_extract', autoDetected: true };
  }
  if (woParsedCount > boParsedCount && woParsedCount > 0) {
    return { type: 'workorders', autoDetected: true };
  }
  if (boParsedCount > 0) {
    return { type: 'backorders', autoDetected: true };
  }

  return { type: 'backorders', autoDetected: false };
}

/**
 * Converts array of BackOrderItems back to CSV string, including Obsolete details
 */
export function exportBackOrdersToCsv(items: BackOrderItem[]): string {
  const headers = [
    'Item',
    'Description',
    'Back Order Qty',
    'Supply Required By Date',
    'Urgency Level',
    'WO Conflict Status',
    'Is Obsolete',
    'Classification Code',
    'Supply Risk',
    'Cancellation Status',
    'Document Number',
    'Status',
    'Expected Ship Date',
    'Customer PO#',
    'Back Order Order Value (EXT Ex GST)',
    'Location',
    'Customer Name',
    'Brand'
  ];

  const rows = items.map(item => [
    `"${item.item}"`,
    `"${(item.productDescription || '').replace(/"/g, '""')}"`,
    item.backOrderQty,
    `"${item.supplyRequiredByDate}"`,
    `"${item.urgency}"`,
    `"${item.conflictStatus}"`,
    `"${item.isObsolete ? 'YES - OBSOLETE' : 'NO'}"`,
    `"${item.classificationCode || 'N/A'}"`,
    `"${item.supplyRisk || 'N/A'}"`,
    `"${item.cancellationStatus || 'PENDING'}"`,
    `"${item.documentNumber}"`,
    `"${item.status}"`,
    `"${item.expectedShipDate}"`,
    `"${item.customerPo}"`,
    item.backOrderValueExGst.toFixed(2),
    `"${item.location}"`,
    `"${item.customerName.replace(/"/g, '""')}"`,
    `"${item.brand}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
