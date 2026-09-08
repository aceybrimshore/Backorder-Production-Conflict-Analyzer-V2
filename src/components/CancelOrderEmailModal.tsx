import React, { useState, useEffect } from 'react';
import { 
  X, 
  Mail, 
  Send, 
  Copy, 
  Check, 
  AlertTriangle, 
  FileText, 
  Building2, 
  MapPin, 
  PackageX, 
  ShieldAlert,
  ExternalLink,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { BackOrderItem, CancellationStatus } from '../types';

interface CancelOrderEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  items?: BackOrderItem[];
  item?: BackOrderItem | null;
  batchItems?: BackOrderItem[];
  onConfirmCancellation?: (orderIds: string[], newStatus: 'EMAIL_SENT' | 'CANCELLED', notes?: string) => void;
  onUpdateStatus?: (itemId: string | string[], status: CancellationStatus, notes?: string) => void;
}

type TemplateType = 'simplified_cs' | 'detailed_erp' | 'warehouse_escalation';

export const CancelOrderEmailModal: React.FC<CancelOrderEmailModalProps> = ({
  isOpen,
  onClose,
  items,
  item,
  batchItems = [],
  onConfirmCancellation,
  onUpdateStatus
}) => {
  // Unpack items if constituentOrders is present (from consolidated view)
  const targetItems = React.useMemo(() => {
    const rawList = items && items.length > 0 ? items : batchItems && batchItems.length > 0 ? batchItems : item ? [item] : [];
    const unpacked: BackOrderItem[] = [];
    rawList.forEach(i => {
      if (i.constituentOrders && i.constituentOrders.length > 0) {
        unpacked.push(...i.constituentOrders);
      } else {
        unpacked.push(i);
      }
    });
    return unpacked;
  }, [items, batchItems, item]);

  const isBatch = targetItems.length > 1;
  const primaryItem = targetItems[0];

  // Group items by SKU / Item Number so all SO numbers per item are clearly aggregated
  const groupedBySku = React.useMemo(() => {
    const map = new Map<string, BackOrderItem[]>();
    targetItems.forEach(i => {
      const sku = i.item;
      if (!map.has(sku)) {
        map.set(sku, []);
      }
      map.get(sku)!.push(i);
    });

    return Array.from(map.entries()).map(([sku, orderList]) => {
      const first = orderList[0];
      const soNumbers = Array.from(new Set(orderList.map(o => o.documentNumber).filter(Boolean)));
      const totalQty = orderList.reduce((sum, o) => sum + o.backOrderQty, 0);
      const totalValue = orderList.reduce((sum, o) => sum + o.backOrderValueExGst, 0);
      const locations = Array.from(new Set(orderList.map(o => o.location).filter(Boolean)));
      const customers = Array.from(new Set(orderList.map(o => o.customerName).filter(Boolean)));
      return {
        sku,
        orderList,
        soNumbers,
        totalQty,
        totalValue,
        locations: locations.join(', ') || 'Warehouse',
        customers,
        description: first.productDescription || first.classCategory || 'Product',
        classificationCode: first.classificationCode || 'Obsolete',
        supplyRisk: first.supplyRisk || 'Obsolete',
        stockOnHand: first.stockOnHand ?? 0
      };
    });
  }, [targetItems]);

  const allUniqueSoNumbers = React.useMemo(() => {
    return Array.from(new Set(targetItems.map(i => i.documentNumber).filter(Boolean)));
  }, [targetItems]);

  const allUniqueLocations = React.useMemo(() => {
    return Array.from(new Set(targetItems.map(i => i.location).filter(Boolean))).join(', ') || 'Warehouse';
  }, [targetItems]);

  const totalBackOrderQty = React.useMemo(() => {
    return targetItems.reduce((acc, i) => acc + i.backOrderQty, 0);
  }, [targetItems]);

  const totalBackOrderValue = React.useMemo(() => {
    return targetItems.reduce((acc, i) => acc + i.backOrderValueExGst, 0);
  }, [targetItems]);

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>('simplified_cs');
  const [recipient, setRecipient] = useState('rrcustomerservice@rhinorack.com.au');
  const [ccRecipient, setCcRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [notes, setNotes] = useState('');
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Always reset to Customer Service template whenever modal opens or active item changes
  useEffect(() => {
    if (isOpen) {
      setSelectedTemplate('simplified_cs');
      setRecipient('rrcustomerservice@rhinorack.com.au');
      setCcRecipient('');
      setNotes('');
    }
  }, [isOpen, primaryItem]);

  // Generate subject & body based on template, item number(s), and all SO numbers
  useEffect(() => {
    if (!primaryItem || targetItems.length === 0 || groupedBySku.length === 0) return;

    const singleGroup = groupedBySku.length === 1 ? groupedBySku[0] : null;
    const soListFormatted = allUniqueSoNumbers.join(', ');

    if (selectedTemplate === 'simplified_cs') {
      setRecipient('rrcustomerservice@rhinorack.com.au');
      setCcRecipient('');

      if (singleGroup) {
        setSubject(`Obsolete Item Sales Order Cancellation Request – SKU ${singleGroup.sku}`);

        setBody(
`Dear Customer Service,

Please cancel sales order lines relating to the obsolete item(s) listed below.

Item Details

Item Number / SKU: ${singleGroup.sku}
Description: ${singleGroup.description}

Sales Orders for Cancellation: ${soListFormatted}


Regards,`
        );
      } else {
        // Multi-SKU Batch
        setSubject(`Obsolete Item Sales Order Cancellation Request – ${allUniqueSoNumbers.length} Sales Orders (${groupedBySku.length} SKUs)`);

        setBody(
`Dear Customer Service,

Please cancel sales order lines relating to the obsolete item(s) listed below.

Item Details

${groupedBySku.map(g => 
`Item Number / SKU: ${g.sku}
Description: ${g.description}
Sales Orders for Cancellation: ${g.soNumbers.join(', ')}`
).join('\n\n')}


Regards,`
        );
      }
    } else if (selectedTemplate === 'detailed_erp') {
      setRecipient('rrcustomerservice@rhinorack.com.au');
      setCcRecipient('');

      if (singleGroup) {
        setSubject(
          `[CANCELLATION REQUEST] Obsolete Item ${singleGroup.sku} - ${allUniqueSoNumbers.length} Sales Order${allUniqueSoNumbers.length === 1 ? '' : 's'} (${singleGroup.locations})`
        );

        setBody(
`Dear Order Processing & Customer Service Team,

Please CANCEL the backordered sales order line(s) for the following obsolete item immediately. This item is officially classified as OBSOLETE with zero manufacturing replenishment or purchase orders scheduled.

============================================================
ITEM DETAILS
============================================================
Item Number / SKU: ${singleGroup.sku}
Description: ${singleGroup.description}
Classification: OBSOLETE (Code: ${singleGroup.classificationCode}) | Supply Risk: ${singleGroup.supplyRisk}
Warehouse Location: ${singleGroup.locations}
Current Stock on Hand: ${singleGroup.stockOnHand} units
Total Sales Orders: ${allUniqueSoNumbers.length}
Total Backorder Quantity: ${singleGroup.totalQty} units
Total Order Value: $${singleGroup.totalValue.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AUD (ex GST)

============================================================
ALL SALES ORDER NUMBERS (FOR BULK ERP CANCELLATION):
============================================================
${soListFormatted}

============================================================
DETAILED BREAKDOWN BY SALES ORDER:
============================================================
${singleGroup.orderList.map(o => 
  `• SO#: ${o.documentNumber} | Customer: ${o.customerName} | PO: ${o.customerPo || 'N/A'} | Qty: ${o.backOrderQty} | Req Date: ${o.supplyRequiredByDate || 'N/A'} | Value: $${o.backOrderValueExGst.toFixed(2)}`
).join('\n')}

REASON FOR CANCELLATION:
Item ${singleGroup.sku} has reached End-of-Life / Obsolete status for warehouse site ${singleGroup.locations}. Physical inventory is exhausted and production lines are decommissioned. These orders cannot be fulfilled.

ACTION REQUIRED:
1. Cancel the backordered line item(s) on all referenced Sales Orders in ERP / NetSuite / SAP.
2. Notify customer service representatives where superseded replacement items may be offered.
3. Release any soft allocations or bin reservations in the warehouse system.

Thank you,
Inventory & Production Planning Team`
        );
      } else {
        // Multi-SKU Batch
        setSubject(
          `[CANCELLATION REQUEST] Batch Obsolete Sales Orders - ${allUniqueSoNumbers.length} SOs across ${groupedBySku.length} Items (${allUniqueLocations})`
        );

        const skuSections = groupedBySku.map(g => 
`------------------------------------------------------------
ITEM NUMBER: ${g.sku} (${g.soNumbers.length} Orders, ${g.totalQty} units)
Description: ${g.description} | Location: ${g.locations} | Class: OBSOLETE (${g.classificationCode})
SO Numbers: ${g.soNumbers.join(', ')}

Line Breakdown:
${g.orderList.map(o => `  • SO#: ${o.documentNumber} | Customer: ${o.customerName} | PO: ${o.customerPo || 'N/A'} | Qty: ${o.backOrderQty} | Req Date: ${o.supplyRequiredByDate || 'N/A'}`).join('\n')}`
        ).join('\n\n');

        setBody(
`Dear Order Processing & Customer Service Team,

Please CANCEL the following sales orders immediately. The items listed below have been verified as OBSOLETE at the specified warehouse locations with zero manufacturing or purchase replenishment available.

SUMMARY OF CANCELLATIONS:
Total Unique Items: ${groupedBySku.length}
Total Sales Orders: ${allUniqueSoNumbers.length}
Total Backorder Units: ${totalBackOrderQty}
Total Backorder Value: $${totalBackOrderValue.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AUD (ex GST)
Affected Facilities: ${allUniqueLocations}

============================================================
ALL SALES ORDER NUMBERS (FOR BULK ERP COPY/PASTE):
============================================================
${soListFormatted}

============================================================
ITEM NUMBERS & ASSOCIATED SALES ORDERS:
============================================================
${skuSections}

ACTION REQUIRED:
1. Cancel the backordered lines on the listed Sales Orders in ERP / NetSuite / SAP.
2. Notify account representatives where alternative models can be recommended.
3. Release soft allocations in warehouse management.

Thank you,
Inventory & Production Planning Team`
        );
      }
    } else {
      // Warehouse Escalation
      setRecipient('warehouse-leads@rhinorack.com.au');
      setCcRecipient('');

      if (singleGroup) {
        setSubject(`[INVENTORY HOLD] Obsolete Item ${singleGroup.sku} - ${allUniqueSoNumbers.length} SOs (${singleGroup.locations})`);
        setBody(
`Warehouse Operations Team,

Please be advised that Sales Orders are pending cancellation for obsolete SKU ${singleGroup.sku} at ${singleGroup.locations}.

ITEM NUMBER: ${singleGroup.sku}
Description: ${singleGroup.description}
Classification: OBSOLETE (Code: ${singleGroup.classificationCode}, Risk: ${singleGroup.supplyRisk})
Current System SOH: ${singleGroup.stockOnHand} units
Total Backorder Demand: ${singleGroup.totalQty} units across ${allUniqueSoNumbers.length} Sales Orders

AFFECTED SALES ORDER NUMBERS:
${soListFormatted}

REQUIRED WAREHOUSE ACTIONS:
1. Confirm physical bin inventory is zero and isolate any residual damaged or stranded units.
2. Do not accept manual assembly traveler releases for this SKU.
3. Remove any active staging or allocation holds tied to the above SO numbers.

Thank you,
Production Planning Management`
        );
      } else {
        setSubject(`[INVENTORY HOLD] Batch Obsolete Items Hold (${groupedBySku.length} SKUs at ${allUniqueLocations})`);
        setBody(
`Warehouse Operations Team,

Please be advised that multiple obsolete SKUs have pending backorders queued for cancellation.

ALL SALES ORDER NUMBERS:
${soListFormatted}

ITEM DETAILS:
${groupedBySku.map(g => 
  `• Item Number: ${g.sku} | Location: ${g.locations} | SOs: ${g.soNumbers.join(', ')}`
).join('\n')}

Please ensure no picking, assembly, or replenishment travelers are initiated for these SKUs.

Thank you,
Production Planning Management`
        );
      }
    }
  }, [primaryItem, targetItems, groupedBySku, allUniqueSoNumbers, allUniqueLocations, totalBackOrderQty, totalBackOrderValue, selectedTemplate]);

  if (!isOpen || targetItems.length === 0) return null;

  const handleCopySoNumbers = async () => {
    try {
      const text = allUniqueSoNumbers.join(', ');
      await navigator.clipboard.writeText(text);
      setCopiedNotification(`Copied ${allUniqueSoNumbers.length} SO number(s) to clipboard!`);
      setTimeout(() => setCopiedNotification(null), 2500);
    } catch {
      // fallback
    }
  };

  const handleCopyBody = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedNotification('Email body copied to clipboard!');
      setTimeout(() => setCopiedNotification(null), 2500);
    } catch {
      // fallback
    }
  };

  const handleCopyFull = async () => {
    try {
      const ccLine = ccRecipient.trim() ? `CC: ${ccRecipient.trim()}\n` : '';
      const fullText = `To: ${recipient}\n${ccLine}Subject: ${subject}\n\n${body}`;
      await navigator.clipboard.writeText(fullText);
      setCopiedNotification('Full email (To, Subject, Body) copied to clipboard!');
      setTimeout(() => setCopiedNotification(null), 2500);
    } catch {
      // fallback
    }
  };

  const handleOpenMailClient = () => {
    const ccPart = ccRecipient.trim() ? `cc=${encodeURIComponent(ccRecipient.trim())}&` : '';
    const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?${ccPart}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;

    // Automatically prompt to update status
    const itemIds = targetItems.map(i => i.id);
    if (onConfirmCancellation) {
      onConfirmCancellation(itemIds, 'EMAIL_SENT', notes || 'Cancellation email launched via mail client');
    }
    if (onUpdateStatus) {
      onUpdateStatus(itemIds, 'EMAIL_SENT', notes || 'Cancellation email launched via mail client');
    }
  };

  const handleMarkStatus = (status: CancellationStatus) => {
    const itemIds = targetItems.map(i => i.id);
    if (onConfirmCancellation && (status === 'EMAIL_SENT' || status === 'CANCELLED')) {
      onConfirmCancellation(itemIds, status, notes || `Marked as ${status} on ${new Date().toLocaleDateString('en-AU')}`);
    }
    if (onUpdateStatus) {
      onUpdateStatus(itemIds, status, notes || `Marked as ${status} on ${new Date().toLocaleDateString('en-AU')}`);
    }
    setCopiedNotification(`Status updated to: ${status}`);
    setTimeout(() => {
      onClose();
    }, 800);
  };

  const singleSkuGroup = groupedBySku.length === 1 ? groupedBySku[0] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-rose-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-rose-900 via-slate-900 to-rose-950 text-white p-5 flex items-start justify-between border-b border-rose-800/40">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 bg-rose-500/20 border border-rose-400/40 rounded-xl text-rose-300 shrink-0 mt-0.5">
              <PackageX className="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-rose-500 text-white shadow-xs">
                  OBSOLETE ITEM NOTICE
                </span>
                <span className="text-xs font-mono text-rose-200">
                  {singleSkuGroup 
                    ? `Item: ${singleSkuGroup.sku} · ${allUniqueSoNumbers.length} SOs`
                    : `${groupedBySku.length} Items · ${allUniqueSoNumbers.length} SOs`}
                </span>
              </div>
              <h2 className="text-lg font-bold text-white mt-1">
                {singleSkuGroup 
                  ? `Cancel SO Notice: Item ${singleSkuGroup.sku} (${allUniqueSoNumbers.length} Sales Order${allUniqueSoNumbers.length === 1 ? '' : 's'})`
                  : `Batch Cancel ${allUniqueSoNumbers.length} Obsolete Sales Orders across ${groupedBySku.length} Items`}
              </h2>
              <p className="text-xs text-rose-200/80 mt-0.5">
                Generate and dispatch cancellation notices specifying item number and all associated Sales Orders.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Item & SO Number Summary Bar */}
        <div className="bg-rose-50/90 border-b border-rose-200 px-5 py-3 text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Item Number */}
            <div className="flex items-center space-x-1.5 font-bold text-slate-800">
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              <span>Item Number:</span>
              <span className="font-mono bg-white px-2.5 py-0.5 rounded-md border border-rose-300 text-rose-800 font-extrabold shadow-2xs">
                {singleSkuGroup ? singleSkuGroup.sku : `${groupedBySku.length} SKUs`}
              </span>
            </div>

            {/* Sales Orders Count & Quick Copy */}
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-600 font-medium">Sales Orders:</span>
              <span className="font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                {allUniqueSoNumbers.length} Orders
              </span>
              <button
                type="button"
                onClick={handleCopySoNumbers}
                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold border border-amber-300 transition-colors cursor-pointer"
                title="Copy comma-separated list of all SO numbers for ERP paste"
              >
                <Copy className="w-3 h-3 text-amber-800" />
                <span>Copy All SO#</span>
              </button>
            </div>

            {/* Location */}
            <div className="flex items-center space-x-1 text-slate-700">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <span>Site:</span>
              <strong className="text-slate-900">{allUniqueLocations}</strong>
            </div>

            {singleSkuGroup && (
              <div className="flex items-center space-x-1">
                <span className="px-2 py-0.5 bg-rose-100 text-rose-900 border border-rose-300 rounded font-bold">
                  Class: {singleSkuGroup.classificationCode} ({singleSkuGroup.supplyRisk})
                </span>
              </div>
            )}
          </div>

          <div className="text-right font-medium text-slate-700">
            Total Qty: <strong className="text-slate-900">{totalBackOrderQty} units</strong> | Total Value: <strong className="text-slate-900">${totalBackOrderValue.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* Notification toast */}
          {copiedNotification && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-3.5 py-2 rounded-xl flex items-center justify-between shadow-xs animate-in fade-in duration-150">
              <div className="flex items-center space-x-2 font-semibold">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{copiedNotification}</span>
              </div>
              <button 
                onClick={() => setCopiedNotification(null)}
                className="text-emerald-700 hover:text-emerald-900 text-[11px] underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Quick SO Numbers Pill List Preview */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-bold text-[11px] text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <span>Associated Sales Orders ({allUniqueSoNumbers.length}):</span>
              </div>
              <button
                type="button"
                onClick={handleCopySoNumbers}
                className="text-[11px] text-amber-700 hover:text-amber-900 font-bold inline-flex items-center space-x-1 cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                <span>Copy SO List</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto custom-scrollbar p-1">
              {allUniqueSoNumbers.map(so => (
                <span
                  key={so}
                  className="font-mono text-[11px] bg-white text-slate-800 px-2 py-0.5 rounded border border-slate-200 shadow-2xs"
                >
                  {so}
                </span>
              ))}
            </div>
          </div>

          {/* Template Selector */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Select Email Template:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSelectedTemplate('simplified_cs')}
                className={`px-3 py-2 rounded-xl text-left border transition-all cursor-pointer ${
                  selectedTemplate === 'simplified_cs'
                    ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-200 text-rose-950 font-bold shadow-xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="font-semibold text-xs">Customer Service (Simplified)</div>
                <div className="text-[10px] text-slate-500">Simplified clean SKU, description & SO list format</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedTemplate('detailed_erp')}
                className={`px-3 py-2 rounded-xl text-left border transition-all cursor-pointer ${
                  selectedTemplate === 'detailed_erp'
                    ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-200 text-rose-950 font-bold shadow-xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="font-semibold text-xs">Detailed ERP Cancel</div>
                <div className="text-[10px] text-slate-500">Includes ERP metrics, values & warehouse actions</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedTemplate('warehouse_escalation')}
                className={`px-3 py-2 rounded-xl text-left border transition-all cursor-pointer ${
                  selectedTemplate === 'warehouse_escalation'
                    ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-200 text-rose-950 font-bold shadow-xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="font-semibold text-xs">Warehouse Ops Hold</div>
                <div className="text-[10px] text-slate-500">Physical bin audit & traveler quarantine</div>
              </button>
            </div>
          </div>

          {/* Email Headers Form */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
                  To:
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-rose-500 focus:outline-hidden font-medium"
                  placeholder="rrcustomerservice@rhinorack.com.au"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5 flex items-center justify-between">
                  <span>CC:</span>
                  <span className="text-slate-400 font-normal lowercase">(blank)</span>
                </label>
                <input
                  type="text"
                  value={ccRecipient}
                  onChange={e => setCcRecipient(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                  placeholder="Leave blank or enter CC"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
                Subject Line:
              </label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Email Body Textarea */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                Message Body:
              </label>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleCopySoNumbers}
                  className="text-[11px] text-amber-700 hover:text-amber-900 inline-flex items-center space-x-1 font-bold cursor-pointer"
                >
                  <Copy className="w-3 h-3 text-amber-600" />
                  <span>Copy SO List</span>
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={handleCopyBody}
                  className="text-[11px] text-slate-600 hover:text-slate-900 inline-flex items-center space-x-1 font-medium hover:underline cursor-pointer"
                >
                  <Copy className="w-3 h-3 text-slate-400" />
                  <span>Copy Body</span>
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={handleCopyFull}
                  className="text-[11px] text-slate-600 hover:text-slate-900 inline-flex items-center space-x-1 font-medium hover:underline cursor-pointer"
                >
                  <FileText className="w-3 h-3 text-slate-400" />
                  <span>Copy Full Email</span>
                </button>
              </div>
            </div>
            <textarea
              rows={12}
              value={body}
              onChange={e => setBody(e.target.value)}
              className="w-full p-3 font-mono text-xs bg-slate-900 text-slate-100 rounded-xl border border-slate-700 focus:ring-2 focus:ring-rose-500 focus:outline-hidden leading-relaxed custom-scrollbar selection:bg-rose-600 selection:text-white"
            />
          </div>

          {/* Internal Audit Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Internal Audit Log Notes (Optional):
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Obsolete in Sydney extract; confirmed by supply chain lead"
              className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
            />
          </div>
        </div>

        {/* Modal Footer / Actions */}
        <div className="p-4 bg-slate-100 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => handleMarkStatus('EMAIL_SENT')}
              className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold border border-slate-300 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs active:scale-95"
              title="Mark all orders as Email Sent in this system"
            >
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>Mark "Email Sent" ({allUniqueSoNumbers.length} SOs)</span>
            </button>

            <button
              type="button"
              onClick={() => handleMarkStatus('CANCELLED')}
              className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold border border-emerald-300 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs active:scale-95"
              title="Mark all orders as officially Cancelled in ERP"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Mark "Cancelled in ERP"</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleCopySoNumbers}
              className="px-3.5 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold border border-amber-300 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs active:scale-95"
            >
              <Copy className="w-3.5 h-3.5 text-amber-800" />
              <span>Copy SO Numbers</span>
            </button>

            <button
              type="button"
              onClick={handleCopyBody}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 font-semibold border border-slate-300 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs active:scale-95"
            >
              <Copy className="w-3.5 h-3.5 text-slate-500" />
              <span>Copy Body</span>
            </button>

            <button
              type="button"
              onClick={handleOpenMailClient}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center space-x-2 transition-colors cursor-pointer shadow-md shadow-rose-600/20 active:scale-95"
            >
              <Mail className="w-4 h-4" />
              <span>Open in Email App</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

