import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  PackageX,
  ExternalLink,
  RotateCcw,
  Sliders,
  Check,
  MoveHorizontal,
  Copy,
  FileSpreadsheet,
  FileText,
  ListOrdered,
  ChevronDown,
  Mail,
  Boxes,
  Layers,
  Info
} from 'lucide-react';
import { BackOrderItem, FilterState, CancellationStatus, UrgencyLevel } from '../types';
import { ensureDate } from '../utils/csvParser';

interface BackOrderTableProps {
  items: BackOrderItem[];
  onSelectItem: (item: BackOrderItem) => void;
  onQuickCreateWo: (item: BackOrderItem) => void;
  onOpenCancelEmailModal?: (item: BackOrderItem) => void;
  onBatchCancelModal?: (items: BackOrderItem[]) => void;
  initialFilterStatus?: string;
  globalLocation?: string;
  globalBrand?: string;
  globalItemType?: string;
  globalCutoffDate?: string | null;
}

export type ColumnKey =
  | 'urgency'
  | 'item'
  | 'type'
  | 'qty'
  | 'requiredDate'
  | 'status'
  | 'value'
  | 'location'
  | 'customer'
  | 'brand'
  | 'action';

export interface ColumnWidths {
  urgency: number;
  item: number;
  type: number;
  qty: number;
  requiredDate: number;
  status: number;
  value: number;
  location: number;
  customer: number;
  brand: number;
  action: number;
}

const STORAGE_KEY_COL_WIDTHS = 'backorder_table_column_widths_v2';

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  urgency: 110,
  item: 175,
  type: 120,
  qty: 95,
  requiredDate: 130,
  status: 165,
  value: 120,
  location: 130,
  customer: 200,
  brand: 120,
  action: 115,
};

const MIN_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  urgency: 75,
  item: 110,
  type: 75,
  qty: 70,
  requiredDate: 90,
  status: 120,
  value: 85,
  location: 90,
  customer: 100,
  brand: 80,
  action: 90,
};

// Clipboard helper that works securely across browser contexts & iframes
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    document.body.removeChild(textArea);
    return false;
  }
}

// Format items for spreadsheet pasting or text export
function formatItemsForClipboard(
  items: BackOrderItem[],
  format: 'tsv' | 'csv' | 'text' | 'skus'
): string {
  if (format === 'skus') {
    return Array.from(new Set(items.map(i => i.item))).join('\n');
  }

  const headers = [
    'Urgency',
    'SKU',
    'Document Number',
    'Customer PO',
    'Item Type',
    'Back Order Qty',
    'Required Date',
    'Work Order Status',
    'Order Value ($)',
    'Location',
    'Customer',
    'Brand'
  ];

  const getRowValues = (i: BackOrderItem) => {
    let woStatusText = 'Covered';
    if (i.isConsolidated) {
      woStatusText = `Obsolete Combined (${i.salesOrderCount} Orders)`;
    } else if (i.isObsolete || i.conflictStatus === 'OBSOLETE') {
      woStatusText = `Obsolete (${i.classificationCode || 'XX'})`;
    } else if (i.isShippingOrNonInventory) woStatusText = 'Non-Inventory';
    else if (i.conflictStatus === 'NO_WORK_ORDER') woStatusText = 'No Work Order';
    else if (i.conflictStatus === 'SCHEDULE_CONFLICT') woStatusText = 'Late Completion Conflict';
    else if (i.conflictStatus === 'QUANTITY_SHORTAGE') woStatusText = 'Quantity Shortage';

    const docStr = i.isConsolidated && i.salesOrderList && i.salesOrderList.length > 0
      ? i.salesOrderList.join(', ')
      : i.documentNumber;

    return [
      i.urgency,
      i.item,
      docStr,
      i.customerPo || '',
      i.typeCategory || i.classCategory || 'Standard',
      i.backOrderQty,
      i.supplyRequiredByDate || '',
      woStatusText,
      i.backOrderValueExGst.toFixed(2),
      i.location || '',
      i.customerName || '',
      i.brand || ''
    ];
  };

  if (format === 'tsv') {
    const rows = items.map(i =>
      getRowValues(i)
        .map(val => String(val).replace(/[\t\r\n]/g, ' '))
        .join('\t')
    );
    return [headers.join('\t'), ...rows].join('\n');
  }

  if (format === 'csv') {
    const escapeCsv = (str: any) => {
      const s = String(str ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = items.map(i => getRowValues(i).map(escapeCsv).join(','));
    return [headers.map(escapeCsv).join(','), ...rows].join('\n');
  }

  // Formatted summary text
  const rows = items.map(i => {
    if (i.isConsolidated) {
      const soList = i.salesOrderList ? i.salesOrderList.join(', ') : i.documentNumber;
      return `• [${i.urgency}] ${i.item} (OBSOLETE COMBINED - ${i.salesOrderCount} SOs: ${soList}) | Total Qty: ${i.backOrderQty} | Req: ${i.supplyRequiredByDate || 'N/A'} | Value: $${i.backOrderValueExGst.toFixed(2)} | Loc: ${i.location || 'N/A'} | Customer: ${i.customerName}`;
    }
    return `• [${i.urgency}] ${i.item} (Doc: ${i.documentNumber}) | Qty: ${i.backOrderQty} | Req: ${i.supplyRequiredByDate || 'N/A'} | Status: ${i.isObsolete || i.conflictStatus === 'OBSOLETE' ? `Obsolete (${i.classificationCode || 'XX'})` : i.conflictStatus} | Value: $${i.backOrderValueExGst.toFixed(2)} | Loc: ${i.location || 'N/A'} | Customer: ${i.customerName}`;
  });
  return `Backorder & Production Conflict Report (${items.length} items):\n` + rows.join('\n');
}

export const BackOrderTable: React.FC<BackOrderTableProps> = ({
  items,
  onSelectItem,
  onQuickCreateWo,
  onOpenCancelEmailModal,
  onBatchCancelModal,
  initialFilterStatus,
  globalLocation = 'ALL',
  globalBrand = 'ALL',
  globalItemType = 'ALL',
  globalCutoffDate = null
}) => {
  // Column widths with persistence
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_COL_WIDTHS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return { ...DEFAULT_COLUMN_WIDTHS, ...parsed };
        }
      }
    } catch {
      // fallback
    }
    return DEFAULT_COLUMN_WIDTHS;
  });

  const [resizingCol, setResizingCol] = useState<ColumnKey | null>(null);
  const [showSaveNotice, setShowSaveNotice] = useState(false);
  const resizeStateRef = useRef<{
    colKey: ColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Selected row IDs for targeted batch copying
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Copy feedback state
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);
  const [showCopyDropdown, setShowCopyDropdown] = useState(false);
  const copyDropdownRef = useRef<HTMLDivElement>(null);
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (copyDropdownRef.current && !copyDropdownRef.current.contains(e.target as Node)) {
        setShowCopyDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-save column widths to localStorage
  const saveColumnWidths = useCallback((widths: ColumnWidths) => {
    try {
      localStorage.setItem(STORAGE_KEY_COL_WIDTHS, JSON.stringify(widths));
      setShowSaveNotice(true);
      setTimeout(() => setShowSaveNotice(false), 2000);
    } catch {
      // Ignore quota errors
    }
  }, []);

  // Handle column resize dragging
  const handleMouseDownResize = (e: React.MouseEvent, colKey: ColumnKey) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = columnWidths[colKey];
    resizeStateRef.current = { colKey, startX, startWidth };
    setResizingCol(colKey);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const delta = moveEvent.clientX - resizeStateRef.current.startX;
      const minW = MIN_COLUMN_WIDTHS[resizeStateRef.current.colKey];
      const newW = Math.max(minW, Math.round(resizeStateRef.current.startWidth + delta));

      setColumnWidths(prev => ({
        ...prev,
        [resizeStateRef.current!.colKey]: newW
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      setColumnWidths(currentWidths => {
        saveColumnWidths(currentWidths);
        return currentWidths;
      });

      resizeStateRef.current = null;
      setResizingCol(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleResetColumnWidth = (colKey: ColumnKey) => {
    setColumnWidths(prev => {
      const updated = { ...prev, [colKey]: DEFAULT_COLUMN_WIDTHS[colKey] };
      saveColumnWidths(updated);
      return updated;
    });
  };

  const handleResetAllWidths = () => {
    setColumnWidths(DEFAULT_COLUMN_WIDTHS);
    saveColumnWidths(DEFAULT_COLUMN_WIDTHS);
  };

  // Calculate total table width
  const totalTableWidth = useMemo(() => {
    return (Object.values(columnWidths) as number[]).reduce((acc: number, w: number) => acc + w, 0) + 40; // 40px for checkbox column
  }, [columnWidths]);

  const [filters, setFilters] = useState<FilterState>({
    search: '',
    urgency: 'ALL',
    conflictStatus: initialFilterStatus || 'ALL',
    brand: globalBrand,
    location: globalLocation,
    itemType: globalItemType,
    cutoffDate: globalCutoffDate,
    excludeShippingNonInventory: true,
    sortBy: 'urgency',
    sortOrder: 'desc'
  });

  // Sync internal state if global props or initialFilterStatus change
  useEffect(() => {
    setFilters(prev => ({
      ...prev,
      conflictStatus: initialFilterStatus || prev.conflictStatus,
      location: globalLocation,
      brand: globalBrand,
      itemType: globalItemType,
      cutoffDate: globalCutoffDate
    }));
    if (initialFilterStatus) {
      setCurrentPage(1);
    }
  }, [initialFilterStatus, globalLocation, globalBrand, globalItemType, globalCutoffDate]);

  // Reset row selection whenever filters or items change so old selections never contaminate a new view or copy output
  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    filters.search,
    filters.urgency,
    filters.conflictStatus,
    filters.brand,
    filters.location,
    filters.itemType,
    filters.cutoffDate,
    filters.excludeShippingNonInventory,
    filters.onlyObsolete,
    filters.consolidatedObsoleteView,
    items
  ]);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Set of expanded SKU item codes for consolidated rows
  const [expandedSkuSet, setExpandedSkuSet] = useState<Set<string>>(new Set());

  const toggleExpandSku = (sku: string) => {
    setExpandedSkuSet(prev => {
      const next = new Set(prev);
      if (next.has(sku)) {
        next.delete(sku);
      } else {
        next.add(sku);
      }
      return next;
    });
  };

  // Obsolete items statistics for quick filters & toggle
  const obsoleteStats = useMemo(() => {
    const rawObsolete = items.filter(
      i => (i.isObsolete || i.conflictStatus === 'OBSOLETE') && (!filters.excludeShippingNonInventory || !i.isShippingOrNonInventory)
    );
    const skuSet = new Set(rawObsolete.map(i => i.item.trim()));
    return {
      orderCount: rawObsolete.length,
      skuCount: skuSet.size
    };
  }, [items, filters.excludeShippingNonInventory]);

  // Extract unique Brands, Locations, and Item Types
  const brands = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      if (i.brand && i.brand.trim()) set.add(i.brand.trim());
    });
    return Array.from(set).sort();
  }, [items]);

  const locations = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      if (i.location && i.location.trim()) set.add(i.location.trim());
    });
    return Array.from(set).sort();
  }, [items]);

  const itemTypes = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      const typeStr = (i.typeCategory || i.classCategory || 'Standard').trim();
      if (typeStr) set.add(typeStr);
    });
    return Array.from(set).sort();
  }, [items]);

  // Filtered & Sorted items
  const filteredItems = useMemo(() => {
    const isCombinedObsolete =
      filters.conflictStatus === 'OBSOLETE_COMBINED' || !!filters.consolidatedObsoleteView;

    const baseItems = items.filter(item => {
      // Exclude Shipping / Non-Inventory if toggled
      if (filters.excludeShippingNonInventory && item.isShippingOrNonInventory) {
        return false;
      }

      // Conflict & Obsolete status filter
      if (filters.conflictStatus !== 'ALL') {
        if (filters.conflictStatus === 'CONFLICTS') {
          if (item.conflictStatus === 'COVERED' || item.conflictStatus === 'EXEMPT' || item.isObsolete || item.conflictStatus === 'OBSOLETE') return false;
        } else if (filters.conflictStatus === 'OBSOLETE' || filters.conflictStatus === 'OBSOLETE_COMBINED') {
          if (!item.isObsolete && item.conflictStatus !== 'OBSOLETE') return false;
        } else if (filters.conflictStatus === 'OBSOLETE_PENDING') {
          if ((!item.isObsolete && item.conflictStatus !== 'OBSOLETE') || item.cancellationStatus === 'CANCELLED') return false;
        } else if (filters.conflictStatus === 'NO_WORK_ORDER') {
          if (item.isObsolete || item.conflictStatus !== 'NO_WORK_ORDER') return false;
        } else if (item.conflictStatus !== filters.conflictStatus) {
          return false;
        }
      }

      // Search filter
      if (filters.search.trim()) {
        const q = filters.search.toLowerCase();
        const matchesSku = item.item.toLowerCase().includes(q);
        const matchesCustomer = item.customerName.toLowerCase().includes(q);
        const matchesDoc = item.documentNumber.toLowerCase().includes(q);
        const matchesPo = item.customerPo.toLowerCase().includes(q);
        if (!matchesSku && !matchesCustomer && !matchesDoc && !matchesPo) return false;
      }

      // Urgency filter
      if (filters.urgency !== 'ALL' && item.urgency !== filters.urgency) {
        return false;
      }

      // Brand filter
      if (filters.brand !== 'ALL' && item.brand !== filters.brand) {
        return false;
      }

      // Location filter
      if (filters.location !== 'ALL' && item.location !== filters.location) {
        return false;
      }

      // Item Type filter
      if (filters.itemType !== 'ALL') {
        const typeStr = (item.typeCategory || item.classCategory || 'Standard').trim();
        if (typeStr !== filters.itemType) {
          return false;
        }
      }

      // Cutoff Date filter
      if (filters.cutoffDate && item.supplyRequiredDateParsed) {
        const cutoffMs = new Date(filters.cutoffDate).getTime();
        const d = ensureDate(item.supplyRequiredDateParsed);
        if (d && d.getTime() > cutoffMs) {
          return false;
        }
      }

      return true;
    });

    // When Obsolete Items (Cancel SO) - Item Combined is active, aggregate by SKU
    if (isCombinedObsolete) {
      const skuMap = new Map<string, BackOrderItem[]>();
      baseItems.forEach(item => {
        const key = item.item.trim();
        if (!skuMap.has(key)) {
          skuMap.set(key, []);
        }
        skuMap.get(key)!.push(item);
      });

      const consolidatedList: BackOrderItem[] = [];
      const urgencyRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

      skuMap.forEach((constituentOrders, sku) => {
        const first = constituentOrders[0];
        const totalQty = constituentOrders.reduce((acc, o) => acc + o.backOrderQty, 0);
        const totalValue = constituentOrders.reduce((acc, o) => acc + o.backOrderValueExGst, 0);
        const allSoNumbers = Array.from(
          new Set(constituentOrders.map(o => o.documentNumber).filter(Boolean))
        );
        const allCustomers = Array.from(
          new Set(constituentOrders.map(o => o.customerName).filter(Boolean))
        );
        const allPos = Array.from(
          new Set(constituentOrders.map(o => o.customerPo).filter(Boolean))
        );
        const allLocations = Array.from(
          new Set(constituentOrders.map(o => o.location).filter(Boolean))
        );

        // Highest urgency in group
        let highestRank = 1;
        let highestUrgency: UrgencyLevel = 'LOW';
        constituentOrders.forEach(o => {
          const r = urgencyRank[o.urgency] || 1;
          if (r > highestRank) {
            highestRank = r;
            highestUrgency = o.urgency;
          }
        });

        // Combined cancellation status
        const allCancelled = constituentOrders.every(o => o.cancellationStatus === 'CANCELLED');
        const allSentOrCancelled = constituentOrders.every(
          o => o.cancellationStatus === 'EMAIL_SENT' || o.cancellationStatus === 'CANCELLED'
        );
        const combinedCancelStatus: CancellationStatus | undefined = allCancelled
          ? 'CANCELLED'
          : allSentOrCancelled
          ? 'EMAIL_SENT'
          : undefined;

        // Earliest supply date
        const parsedDates = constituentOrders
          .map(o => (o.supplyRequiredDateParsed ? ensureDate(o.supplyRequiredDateParsed) : null))
          .filter((d): d is Date => d !== null)
          .sort((a, b) => a.getTime() - b.getTime());

        const earliestDateStr = parsedDates.length > 0
          ? parsedDates[0].toLocaleDateString('en-AU')
          : first.supplyRequiredByDate;

        const docText = allSoNumbers.length === 1
          ? allSoNumbers[0]
          : `${allSoNumbers.length} SOs (${allSoNumbers.slice(0, 2).join(', ')}${allSoNumbers.length > 2 ? '...' : ''})`;

        const custText = allCustomers.length === 1
          ? allCustomers[0]
          : `${allCustomers[0]} (+${allCustomers.length - 1} more)`;

        const poText = allPos.length === 1
          ? allPos[0]
          : allPos.length > 1
          ? `${allPos.length} POs`
          : '—';

        consolidatedList.push({
          ...first,
          id: `consolidated-${sku}`,
          item: sku,
          documentNumber: docText,
          customerName: custText,
          customerPo: poText,
          backOrderQty: totalQty,
          backOrderValueExGst: totalValue,
          location: allLocations.join(', ') || first.location,
          urgency: highestUrgency,
          cancellationStatus: combinedCancelStatus,
          supplyRequiredByDate: earliestDateStr,
          supplyRequiredDateParsed: parsedDates[0] || first.supplyRequiredDateParsed,
          isConsolidated: true,
          salesOrderCount: constituentOrders.length,
          salesOrderList: allSoNumbers,
          constituentOrders: constituentOrders,
          conflictDetails: `${constituentOrders.length} Sales Order(s) pending cancellation across ${allSoNumbers.length} unique SO numbers for obsolete SKU ${sku}.`
        });
      });

      return consolidatedList.sort((a, b) => {
        const order = filters.sortOrder === 'asc' ? 1 : -1;
        if (filters.sortBy === 'urgency') {
          const rank: Record<UrgencyLevel, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
          const diff = rank[b.urgency] - rank[a.urgency];
          return filters.sortOrder === 'asc' ? -diff : diff;
        }
        if (filters.sortBy === 'value') {
          return (a.backOrderValueExGst - b.backOrderValueExGst) * order;
        }
        if (filters.sortBy === 'qty') {
          return (a.backOrderQty - b.backOrderQty) * order;
        }
        if (filters.sortBy === 'item') {
          return a.item.localeCompare(b.item) * order;
        }
        return 0;
      });
    }

    return baseItems.sort((a, b) => {
      const order = filters.sortOrder === 'asc' ? 1 : -1;

      if (filters.sortBy === 'urgency') {
        const rank: Record<UrgencyLevel, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        const diff = rank[b.urgency] - rank[a.urgency];
        return filters.sortOrder === 'asc' ? -diff : diff;
      }

      if (filters.sortBy === 'value') {
        return (a.backOrderValueExGst - b.backOrderValueExGst) * order;
      }

      if (filters.sortBy === 'qty') {
        return (a.backOrderQty - b.backOrderQty) * order;
      }

      if (filters.sortBy === 'requiredDate') {
        const dateA = ensureDate(a.supplyRequiredDateParsed);
        const dateB = ensureDate(b.supplyRequiredDateParsed);
        const dA = dateA ? dateA.getTime() : Infinity;
        const dB = dateB ? dateB.getTime() : Infinity;
        return (dA - dB) * order;
      }

      if (filters.sortBy === 'item') {
        return a.item.localeCompare(b.item) * order;
      }

      return 0;
    });
  }, [items, filters]);

  // Selected items that actually exist in the current filteredItems set
  const selectedFilteredItems = useMemo(() => {
    return filteredItems.filter(i => selectedIds.has(i.id));
  }, [filteredItems, selectedIds]);

  const selectedCount = selectedFilteredItems.length;

  // Target items to copy (either checked items or all filtered items)
  const itemsToCopy = useMemo(() => {
    if (selectedCount > 0) {
      return selectedFilteredItems;
    }
    return filteredItems;
  }, [filteredItems, selectedCount, selectedFilteredItems]);

  // Selected obsolete items for batch cancellation (unpacks consolidated items if selected)
  const selectedObsoleteItems = useMemo(() => {
    const directMatches = selectedFilteredItems.filter(i => i.isObsolete || i.conflictStatus === 'OBSOLETE');
    const unpacked: BackOrderItem[] = [];
    directMatches.forEach(i => {
      if (i.constituentOrders && i.constituentOrders.length > 0) {
        unpacked.push(...i.constituentOrders);
      } else {
        unpacked.push(i);
      }
    });
    return unpacked;
  }, [selectedFilteredItems]);

  // Handle Copy Trigger
  const handleCopy = async (
    format: 'tsv' | 'csv' | 'text' | 'skus' = 'tsv',
    overrideItems?: BackOrderItem[]
  ) => {
    const targetItems = overrideItems || itemsToCopy;
    if (targetItems.length === 0) return;

    const formattedText = formatItemsForClipboard(targetItems, format);
    const success = await copyTextToClipboard(formattedText);

    setShowCopyDropdown(false);

    if (success) {
      const formatNames: Record<string, string> = {
        tsv: 'Excel / Google Sheets (Tab-delimited)',
        csv: 'CSV',
        text: 'Text Report',
        skus: 'SKU List'
      };
      setCopiedNotification(
        `✓ Copied ${targetItems.length} item${targetItems.length === 1 ? '' : 's'} as ${formatNames[format]}! Ready to paste.`
      );
      setTimeout(() => {
        setCopiedNotification(null);
      }, 3500);
    }
  };

  // Quick single-row copy
  const handleCopySingleRow = async (e: React.MouseEvent, item: BackOrderItem) => {
    e.stopPropagation();
    const formatted = formatItemsForClipboard([item], 'tsv');
    const success = await copyTextToClipboard(formatted);
    if (success) {
      setCopiedRowId(item.id);
      setTimeout(() => setCopiedRowId(null), 1500);
    }
  };

  // Pagination
  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  // Page vs All selection state
  const isAllPageSelected = paginatedItems.length > 0 && paginatedItems.every(i => selectedIds.has(i.id));
  const isAllFilteredSelected = filteredItems.length > 0 && selectedCount === filteredItems.length;
  const isPartiallyPageSelected = paginatedItems.some(i => selectedIds.has(i.id)) && !isAllPageSelected;
  const isPartiallyFilteredSelected = selectedCount > 0 && !isAllFilteredSelected;

  const toggleSelectPage = () => {
    if (isAllPageSelected) {
      // Unselect all items on current page
      setSelectedIds(prev => {
        const next = new Set(prev);
        paginatedItems.forEach(i => next.delete(i.id));
        return next;
      });
    } else {
      // Select all items on current page
      setSelectedIds(prev => {
        const next = new Set(prev);
        paginatedItems.forEach(i => next.add(i.id));
        return next;
      });
    }
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredItems.map(i => i.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const toggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSort = (field: FilterState['sortBy']) => {
    if (filters.sortBy === field) {
      setFilters(prev => ({ ...prev, sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' }));
    } else {
      setFilters(prev => ({ ...prev, sortBy: field, sortOrder: 'desc' }));
    }
  };

  // Resizer header cell component helper
  const renderHeaderCell = (
    colKey: ColumnKey,
    label: string,
    sortField?: FilterState['sortBy'],
    align: 'left' | 'right' = 'left'
  ) => {
    const width = columnWidths[colKey];
    const isResizing = resizingCol === colKey;

    return (
      <th
        style={{ width: `${width}px`, minWidth: `${MIN_COLUMN_WIDTHS[colKey]}px` }}
        className={`relative py-3 px-3.5 bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200 uppercase tracking-wider select-none text-[11px] group ${
          align === 'right' ? 'text-right' : 'text-left'
        } ${isResizing ? 'bg-amber-100/70 text-slate-900' : ''}`}
      >
        <div className={`flex items-center space-x-1 ${align === 'right' ? 'justify-end' : 'justify-between'}`}>
          {sortField ? (
            <button
              onClick={() => toggleSort(sortField)}
              className="flex items-center space-x-1 hover:text-slate-900 truncate focus:outline-hidden"
              title={`Sort by ${label}`}
            >
              <span className="truncate">{label}</span>
              <ArrowUpDown className="w-3 h-3 shrink-0 text-slate-400 group-hover:text-slate-700" />
            </button>
          ) : (
            <span className="truncate">{label}</span>
          )}
        </div>

        {/* Resizer Handle */}
        <div
          onMouseDown={e => handleMouseDownResize(e, colKey)}
          onDoubleClick={() => handleResetColumnWidth(colKey)}
          className={`absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize z-20 flex items-center justify-center transition-colors group/resizer hover:bg-amber-400 ${
            isResizing ? 'bg-amber-500' : 'bg-transparent'
          }`}
          title="Drag to resize column (Double-click to reset)"
        >
          <div className="w-[1.5px] h-3.5 bg-slate-300 group-hover/resizer:bg-slate-800 transition-colors" />
        </div>
      </th>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
      {/* Search & Filters Toolbar */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by SKU, Customer, SO#, PO#..."
              value={filters.search}
              onChange={e => {
                setFilters(prev => ({ ...prev, search: e.target.value }));
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>

          {/* Right Toolbar Controls: Copy, Non-Inventory & Reset */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Non-Inventory Toggle */}
            <label className="flex items-center space-x-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.excludeShippingNonInventory}
                onChange={e => {
                  setFilters(prev => ({ ...prev, excludeShippingNonInventory: e.target.checked }));
                  setCurrentPage(1);
                }}
                className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4 border-slate-300 cursor-pointer"
              />
              <span>Exclude Shipping & Non-Inventory</span>
            </label>

            {/* Copy to Clipboard Dropdown & Quick Action */}
            <div className="relative" ref={copyDropdownRef}>
              <div className="inline-flex items-center rounded-lg shadow-2xs">
                <button
                  onClick={() => handleCopy('tsv')}
                  disabled={filteredItems.length === 0}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-slate-800 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-l-lg border border-amber-500/60 transition-colors cursor-pointer"
                  title="Copy to clipboard for Excel / Google Sheets (Tab-delimited)"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-900" />
                  <span>
                    {selectedCount > 0
                      ? `Copy ${selectedCount} Selected`
                      : `Copy All (${filteredItems.length})`}
                  </span>
                </button>
                <button
                  onClick={() => setShowCopyDropdown(prev => !prev)}
                  disabled={filteredItems.length === 0}
                  className="px-2 py-1.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-r-lg border-y border-r border-amber-500/60 border-l border-l-amber-500/30 transition-colors text-slate-900 cursor-pointer"
                  title="More copy formats (CSV, Text, SKU list)"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Copy Format Options Menu */}
              {showCopyDropdown && (
                <div className="absolute right-0 mt-1.5 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-40 text-xs animate-in fade-in zoom-in-95 duration-100">
                  {/* Selection Context Header */}
                  <div className="px-3 pb-2 mb-1 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                        {selectedCount > 0 ? `Target: ${selectedCount} Selected Items` : `Target: All ${filteredItems.length} Items`}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {selectedCount > 0 ? 'Only checked items will be copied' : 'Entire current view will be copied'}
                      </div>
                    </div>
                    {selectedCount > 0 && (
                      <button
                        onClick={clearSelection}
                        className="text-[10px] font-semibold text-amber-700 hover:text-amber-900 underline cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Quick scope overrides if items selected */}
                  {selectedCount > 0 && (
                    <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 font-medium">Or copy:</span>
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => handleCopy('tsv', paginatedItems)}
                          className="px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
                          title="Copy only the rows visible on this page"
                        >
                          Page ({paginatedItems.length})
                        </button>
                        <button
                          onClick={() => handleCopy('tsv', filteredItems)}
                          className="px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
                          title="Copy all items in this view regardless of selection"
                        >
                          All ({filteredItems.length})
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="pt-1">
                    <button
                      onClick={() => handleCopy('tsv')}
                      className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center space-x-2.5 text-slate-800 font-medium cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div>
                        <div className="font-semibold text-slate-900">Excel / Google Sheets (TSV)</div>
                        <div className="text-[10px] text-slate-500">Directly paste rows into spreadsheet cells</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleCopy('csv')}
                      className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center space-x-2.5 text-slate-800 font-medium cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                      <div>
                        <div className="font-semibold text-slate-900">Comma-Separated (CSV)</div>
                        <div className="text-[10px] text-slate-500">Standard CSV format with quotes & headers</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleCopy('text')}
                      className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center space-x-2.5 text-slate-800 font-medium cursor-pointer"
                    >
                      <ListOrdered className="w-4 h-4 text-purple-600 shrink-0" />
                      <div>
                        <div className="font-semibold text-slate-900">Formatted Text Report</div>
                        <div className="text-[10px] text-slate-500">Clean bullets for emails, Teams & Slack</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleCopy('skus')}
                      className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center space-x-2.5 text-slate-800 font-medium cursor-pointer border-t border-slate-100"
                    >
                      <Copy className="w-4 h-4 text-amber-600 shrink-0" />
                      <div>
                        <div className="font-semibold text-slate-900">SKU List Only</div>
                        <div className="text-[10px] text-slate-500">Newline-delimited SKU codes</div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Batch Cancel SO Email Button */}
            {selectedObsoleteItems.length > 0 && onBatchCancelModal && (
              <button
                onClick={() => onBatchCancelModal(selectedObsoleteItems)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow-2xs border border-rose-700 transition-colors cursor-pointer active:scale-95 animate-in fade-in duration-150"
                title="Draft batch cancellation email for selected obsolete sales orders"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Cancel SO Email ({selectedObsoleteItems.length})</span>
              </button>
            )}

            {/* Column Width Reset & Auto-save Status */}
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
              {showSaveNotice && (
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-in fade-in duration-150">
                  <Check className="w-3 h-3" />
                  <span>Column Widths Auto-Saved</span>
                </span>
              )}

              <button
                onClick={handleResetAllWidths}
                className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors shadow-2xs"
                title="Reset all columns to default widths"
              >
                <RotateCcw className="w-3 h-3 text-slate-400" />
                <span>Reset Columns</span>
              </button>
            </div>
          </div>
        </div>

        {/* Feedback Alert when copied */}
        {copiedNotification && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-between shadow-xs animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center space-x-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{copiedNotification}</span>
            </div>
            <button
              onClick={() => setCopiedNotification(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs underline font-normal cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <div className="flex items-center space-x-1.5 font-semibold text-slate-500 mr-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Filters:</span>
          </div>

          {/* Urgency Filter */}
          <select
            value={filters.urgency}
            onChange={e => {
              setFilters(prev => ({ ...prev, urgency: e.target.value }));
              setCurrentPage(1);
            }}
            className="bg-white border border-slate-300 rounded-md px-2.5 py-1 text-xs text-slate-700 focus:ring-2 focus:ring-amber-500"
          >
            <option value="ALL">All Urgency Levels</option>
            <option value="CRITICAL">🔴 Critical / Overdue</option>
            <option value="HIGH">🟠 High Priority</option>
            <option value="MEDIUM">🟡 Medium Priority</option>
            <option value="LOW">🟢 Low Priority</option>
          </select>

          {/* Conflict Filter */}
          <select
            value={filters.conflictStatus}
            onChange={e => {
              setFilters(prev => ({ ...prev, conflictStatus: e.target.value }));
              setCurrentPage(1);
            }}
            className={`rounded-md px-2.5 py-1 text-xs focus:ring-2 focus:ring-amber-500 font-medium ${
              filters.conflictStatus === 'OBSOLETE' || filters.conflictStatus === 'OBSOLETE_COMBINED'
                ? 'bg-rose-50 border-rose-300 text-rose-900 ring-1 ring-rose-300'
                : 'bg-white border-slate-300 text-slate-700'
            }`}
          >
            <option value="ALL">All WO Conflict Statuses</option>
            <option value="OBSOLETE">🚨 Obsolete Items (Cancel SO) - Detailed ({obsoleteStats.orderCount})</option>
            <option value="OBSOLETE_COMBINED">📦 Obsolete Items (Cancel SO) - Item Combined ({obsoleteStats.skuCount} SKUs)</option>
            <option value="OBSOLETE_PENDING">🚨 Obsolete - Pending Cancellation</option>
            <option value="CONFLICTS">⚠️ Any Conflict / Missing WO</option>
            <option value="NO_WORK_ORDER">🔴 No Work Order</option>
            <option value="SCHEDULE_CONFLICT">⚠️ Schedule Late Conflict</option>
            <option value="QUANTITY_SHORTAGE">📉 Quantity Shortage</option>
            <option value="COVERED">🟢 Covered by WO</option>
          </select>

          {/* Obsolete View Mode Toggle Pill */}
          {(filters.conflictStatus === 'OBSOLETE' || filters.conflictStatus === 'OBSOLETE_COMBINED') && (
            <div className="inline-flex items-center rounded-lg p-0.5 bg-rose-100 border border-rose-200 text-xs shadow-2xs">
              <button
                type="button"
                onClick={() => {
                  setFilters(prev => ({ ...prev, conflictStatus: 'OBSOLETE' }));
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md font-bold text-[11px] transition-all cursor-pointer flex items-center space-x-1 ${
                  filters.conflictStatus === 'OBSOLETE'
                    ? 'bg-white text-rose-950 shadow-xs'
                    : 'text-rose-700 hover:text-rose-900'
                }`}
                title="View every individual sales order line"
              >
                <span>📋 Detailed SOs ({obsoleteStats.orderCount})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilters(prev => ({ ...prev, conflictStatus: 'OBSOLETE_COMBINED' }));
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md font-bold text-[11px] transition-all cursor-pointer flex items-center space-x-1 ${
                  filters.conflictStatus === 'OBSOLETE_COMBINED'
                    ? 'bg-white text-rose-950 shadow-xs'
                    : 'text-rose-700 hover:text-rose-900'
                }`}
                title="Combine and aggregate all sales orders by item number"
              >
                <Boxes className="w-3 h-3 text-rose-600" />
                <span>📦 Item Combined ({obsoleteStats.skuCount} SKUs)</span>
              </button>
            </div>
          )}

          {/* Brand Filter */}
          <select
            value={filters.brand}
            onChange={e => {
              setFilters(prev => ({ ...prev, brand: e.target.value }));
              setCurrentPage(1);
            }}
            className="bg-white border border-slate-300 rounded-md px-2.5 py-1 text-xs text-slate-700 focus:ring-2 focus:ring-amber-500"
          >
            <option value="ALL">All Brands</option>
            {brands.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          {/* Location Filter */}
          <select
            value={filters.location}
            onChange={e => {
              setFilters(prev => ({ ...prev, location: e.target.value }));
              setCurrentPage(1);
            }}
            className="bg-white border border-slate-300 rounded-md px-2.5 py-1 text-xs text-slate-700 focus:ring-2 focus:ring-amber-500"
          >
            <option value="ALL">All Locations</option>
            {locations.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>

          {/* Item Type Filter */}
          <select
            value={filters.itemType}
            onChange={e => {
              setFilters(prev => ({ ...prev, itemType: e.target.value }));
              setCurrentPage(1);
            }}
            className="bg-white border border-slate-300 rounded-md px-2.5 py-1 text-xs text-slate-700 focus:ring-2 focus:ring-amber-500"
          >
            <option value="ALL">All Item Types</option>
            {itemTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Drag Columns Tip */}
          <div className="hidden lg:flex items-center space-x-1 text-[11px] text-slate-400 ml-2">
            <MoveHorizontal className="w-3.5 h-3.5 text-amber-500" />
            <span>Drag column dividers to resize</span>
          </div>

          {/* Results Count & Selection Indicator */}
          <div className="ml-auto text-slate-500 font-medium flex items-center space-x-2">
            {selectedCount > 0 && (
              <span className="bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded text-[11px] border border-amber-300 flex items-center space-x-1.5 shadow-2xs">
                <span>{selectedCount} selected</span>
                <button
                  onClick={clearSelection}
                  className="text-amber-700 hover:text-amber-950 font-bold cursor-pointer ml-0.5"
                  title="Clear selection"
                >
                  ✕
                </button>
              </span>
            )}
            <span>
              Showing <strong className="text-slate-900">{filteredItems.length}</strong> items
            </span>
          </div>
        </div>
      </div>

      {/* Obsolete Combined Explanatory Banner */}
      {filters.conflictStatus === 'OBSOLETE_COMBINED' && (
        <div className="px-4 py-2.5 bg-rose-50/90 border-b border-rose-200 flex flex-wrap items-center justify-between gap-2.5 text-xs text-rose-950">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-rose-200/80 text-rose-800 shrink-0 shadow-2xs">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-rose-900">Obsolete Items (Cancel SO) — Item Combined View:</span>{' '}
              <span className="text-slate-700">
                Consolidated {obsoleteStats.orderCount} sales orders into <strong className="text-rose-900">{filteredItems.length} unique items</strong>.
                Click the <span className="font-bold text-slate-800">arrow (▶)</span> next to any item to expand its individual orders, or click <strong className="text-rose-700">Cancel SO</strong> to generate an email cancellation notice that groups all associated Sales Orders for that item.
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (expandedSkuSet.size === filteredItems.length) {
                  setExpandedSkuSet(new Set());
                } else {
                  setExpandedSkuSet(new Set(filteredItems.map(i => i.item)));
                }
              }}
              className="px-2.5 py-1 bg-white hover:bg-rose-100 text-rose-800 font-semibold border border-rose-300 rounded-md text-[11px] transition-colors cursor-pointer shadow-2xs"
            >
              {expandedSkuSet.size === filteredItems.length ? 'Collapse All Orders' : 'Expand All Orders'}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilters(prev => ({ ...prev, conflictStatus: 'OBSOLETE' }));
                setCurrentPage(1);
              }}
              className="px-2.5 py-1 bg-white hover:bg-rose-100 text-rose-800 font-semibold border border-rose-300 rounded-md text-[11px] transition-colors cursor-pointer shadow-2xs"
            >
              Switch to Detailed Lines
            </button>
          </div>
        </div>
      )}

      {/* Multi-page selection banner when items on current page are selected and more items exist across pages */}
      {isAllPageSelected && filteredItems.length > paginatedItems.length && (
        <div className="bg-amber-50 border-y border-amber-200/80 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 text-amber-900 animate-in fade-in duration-100">
          <div className="flex items-center space-x-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              {!isAllFilteredSelected ? (
                <>
                  All <strong>{paginatedItems.length}</strong> items on this page are selected.{' '}
                  <button
                    onClick={selectAllFiltered}
                    className="font-bold underline text-amber-800 hover:text-amber-950 ml-1 cursor-pointer"
                  >
                    Select all {filteredItems.length} items in this view
                  </button>
                </>
              ) : (
                <>
                  All <strong>{filteredItems.length}</strong> items across all {totalPages} pages are selected.
                </>
              )}
            </span>
          </div>
          <button
            onClick={clearSelection}
            className="font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer text-xs ml-auto"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Main Backorder Table with Resizable Layout & Safe Clipboard Row Copying */}
      <div className="overflow-x-auto custom-scrollbar w-full relative select-text">
        <table
          className="w-full text-left border-collapse text-xs table-fixed"
          style={{ minWidth: `${Math.max(1050, totalTableWidth)}px` }}
        >
          <thead>
            <tr>
              {/* Checkbox Column */}
              <th className="w-10 py-3 px-3 bg-slate-100/90 text-slate-700 border-b border-slate-200 text-center select-none">
                <input
                  type="checkbox"
                  checked={isAllPageSelected}
                  ref={input => {
                    if (input) input.indeterminate = isPartiallyPageSelected;
                  }}
                  onChange={toggleSelectPage}
                  className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4 border-slate-300 cursor-pointer"
                  title={isAllPageSelected ? 'Deselect page items' : 'Select all items on this page'}
                />
              </th>

              {renderHeaderCell('urgency', 'Urgency', 'urgency')}
              {renderHeaderCell('item', 'SKU / Item', 'item')}
              {renderHeaderCell('type', 'Type')}
              {renderHeaderCell('qty', 'BO Qty', 'qty')}
              {renderHeaderCell('requiredDate', 'Required Date', 'requiredDate')}
              {renderHeaderCell('status', 'Work Order Status')}
              {renderHeaderCell('value', 'Order Value', 'value')}
              {renderHeaderCell('location', 'Location')}
              {renderHeaderCell('customer', 'Customer')}
              {renderHeaderCell('brand', 'Brand')}
              {renderHeaderCell('action', 'Action', undefined, 'right')}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800 select-text">
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Sliders className="w-8 h-8 text-slate-300" />
                    <p className="font-semibold text-slate-700">No backorder items match your search or filters.</p>
                    <p className="text-xs text-slate-400">Try adjusting your filters or search query above.</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedItems.map(item => {
                const isCritical = item.urgency === 'CRITICAL';
                const isNoWo = item.conflictStatus === 'NO_WORK_ORDER';
                const isConflict = item.conflictStatus === 'SCHEDULE_CONFLICT';
                const isSelected = selectedIds.has(item.id);
                const isJustCopied = copiedRowId === item.id;
                const isExpanded = !!(item.isConsolidated && expandedSkuSet.has(item.item));

                return (
                  <React.Fragment key={item.id}>
                    <tr
                      className={`hover:bg-slate-50/80 transition-colors ${
                        item.isConsolidated ? 'bg-rose-50/20 font-normal' : ''
                      } ${isSelected ? 'bg-amber-50/60' : !item.isConsolidated && isCritical ? 'bg-red-50/25' : ''}`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-3 align-middle text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => toggleSelectRow(item.id, e)}
                          className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4 border-slate-300 cursor-pointer"
                        />
                      </td>

                      {/* Urgency Badge */}
                      <td
                        style={{ width: `${columnWidths.urgency}px` }}
                        className="py-3 px-3.5 align-middle truncate"
                      >
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            item.urgency === 'CRITICAL'
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : item.urgency === 'HIGH'
                              ? 'bg-orange-100 text-orange-800 border border-orange-200'
                              : item.urgency === 'MEDIUM'
                              ? 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {item.urgency}
                        </span>
                      </td>

                      {/* SKU / Item */}
                      <td
                        style={{ width: `${columnWidths.item}px` }}
                        className="py-3 px-3.5 align-middle"
                      >
                        {item.isConsolidated ? (
                          <div className="flex items-start space-x-1.5 min-w-0">
                            <button
                              type="button"
                              onClick={() => toggleExpandSku(item.item)}
                              className="mt-0.5 p-0.5 hover:bg-rose-100 rounded text-slate-500 hover:text-rose-900 transition-colors cursor-pointer shrink-0"
                              title={isExpanded ? 'Collapse constituent orders' : 'Expand constituent orders'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-rose-600" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <div className="truncate min-w-0">
                              <div className="flex items-center space-x-1.5 truncate">
                                <button
                                  onClick={() => onSelectItem(item)}
                                  className="hover:text-amber-600 hover:underline font-mono font-bold text-slate-900 truncate text-left cursor-pointer"
                                  title={item.item}
                                >
                                  {item.item}
                                </button>
                                <span className="px-1.5 py-0.2 bg-rose-100 text-rose-800 rounded font-sans font-bold text-[9px] border border-rose-200 shrink-0">
                                  {item.salesOrderCount} Orders
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-sans font-normal truncate" title={`Consolidated SOs: ${item.salesOrderList?.join(', ')}`}>
                                Doc: {item.documentNumber}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="truncate">
                            <button
                              onClick={() => onSelectItem(item)}
                              className="hover:text-amber-600 hover:underline font-mono font-bold text-slate-900 truncate max-w-full text-left cursor-pointer"
                              title={item.item}
                            >
                              {item.item}
                            </button>
                            <div className="text-[10px] text-slate-400 font-sans font-normal truncate" title={`Doc: ${item.documentNumber}`}>
                              Doc: {item.documentNumber}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Item Type */}
                      <td
                        style={{ width: `${columnWidths.type}px` }}
                        className="py-3 px-3.5 align-middle text-slate-600 font-medium truncate"
                      >
                        <span
                          className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 text-[10px] font-semibold truncate inline-block max-w-full"
                          title={item.typeCategory || item.classCategory || 'Standard'}
                        >
                          {item.typeCategory || item.classCategory || 'Standard'}
                        </span>
                      </td>

                      {/* Back Order Qty */}
                      <td
                        style={{ width: `${columnWidths.qty}px` }}
                        className="py-3 px-3.5 align-middle font-bold text-slate-900 truncate"
                      >
                        {item.backOrderQty.toLocaleString()}
                      </td>

                      {/* Supply Required Date */}
                      <td
                        style={{ width: `${columnWidths.requiredDate}px` }}
                        className="py-3 px-3.5 align-middle font-medium text-slate-900 whitespace-nowrap truncate"
                      >
                        {item.supplyRequiredByDate || 'N/A'}
                      </td>

                      {/* Work Order Conflict Status Badge */}
                      <td
                        style={{ width: `${columnWidths.status}px` }}
                        className="py-3 px-3.5 align-middle"
                      >
                        {item.isConsolidated ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-bold border border-rose-300 text-[10px] tracking-tight truncate max-w-full">
                              <Boxes className="w-3 h-3 text-rose-600 shrink-0" />
                              <span className="truncate">OBSOLETE COMBINED</span>
                            </span>
                            <div>
                              {item.cancellationStatus === 'CANCELLED' ? (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-semibold text-[9px] border border-slate-300">
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                  <span>All {item.salesOrderCount} SOs Cancelled</span>
                                </span>
                              ) : item.cancellationStatus === 'EMAIL_SENT' ? (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 font-semibold text-[9px] border border-blue-200">
                                  <Mail className="w-2.5 h-2.5 text-blue-600" />
                                  <span>Notice Sent</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 font-semibold text-[9px] border border-rose-200">
                                  <span>{item.salesOrderCount} Orders Pending Cancel</span>
                                </span>
                              )}
                            </div>
                          </div>
                        ) : item.isObsolete ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-bold border border-rose-300 text-[10px] tracking-tight truncate max-w-full">
                              <PackageX className="w-3 h-3 text-rose-600 shrink-0" />
                              <span className="truncate">OBSOLETE ({item.classificationCode || 'XX'})</span>
                            </span>
                            <div>
                              {item.cancellationStatus === 'CANCELLED' ? (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-semibold text-[9px] border border-slate-300">
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                  <span>SO Cancelled</span>
                                </span>
                              ) : item.cancellationStatus === 'EMAIL_SENT' ? (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 font-semibold text-[9px] border border-blue-200">
                                  <Mail className="w-2.5 h-2.5 text-blue-600" />
                                  <span>Email Sent</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 font-semibold text-[9px] border border-rose-200">
                                  <span>Cancel Needed</span>
                                </span>
                              )}
                            </div>
                          </div>
                        ) : item.isShippingOrNonInventory ? (
                          <span className="text-slate-400 italic text-[11px]">Non-inventory</span>
                        ) : isNoWo ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold border border-red-200 text-[11px] truncate max-w-full">
                            <PackageX className="w-3 h-3 text-red-600 shrink-0" />
                            <span className="truncate">No Work Order</span>
                          </span>
                        ) : isConflict ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold border border-amber-200 text-[11px] truncate max-w-full">
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                            <span className="truncate">Late Completion</span>
                          </span>
                        ) : item.conflictStatus === 'QUANTITY_SHORTAGE' ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 font-bold border border-yellow-200 text-[11px] truncate max-w-full">
                            <span className="truncate">Qty Shortage</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold border border-emerald-200 text-[11px] truncate max-w-full">
                            <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span className="truncate">WO Scheduled</span>
                          </span>
                        )}
                      </td>

                      {/* Order Value */}
                      <td
                        style={{ width: `${columnWidths.value}px` }}
                        className="py-3 px-3.5 align-middle font-semibold text-slate-900 whitespace-nowrap truncate"
                      >
                        ${item.backOrderValueExGst.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Location */}
                      <td
                        style={{ width: `${columnWidths.location}px` }}
                        className="py-3 px-3.5 align-middle font-medium text-amber-900 whitespace-nowrap truncate"
                      >
                        <span
                          className="bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60 font-semibold text-[11px] truncate inline-block max-w-full"
                          title={item.location || 'Unassigned'}
                        >
                          📍 {item.location || 'Unassigned'}
                        </span>
                      </td>

                      {/* Customer */}
                      <td
                        style={{ width: `${columnWidths.customer}px` }}
                        className="py-3 px-3.5 align-middle text-slate-700 truncate"
                        title={item.customerName}
                      >
                        {item.customerName}
                      </td>

                      {/* Brand */}
                      <td
                        style={{ width: `${columnWidths.brand}px` }}
                        className="py-3 px-3.5 align-middle font-medium text-slate-600 truncate"
                        title={item.brand || 'Other'}
                      >
                        {item.brand || 'Other'}
                      </td>

                      {/* Action & Quick Copy */}
                      <td
                        style={{ width: `${columnWidths.action}px` }}
                        className="py-3 px-3.5 align-middle text-right whitespace-nowrap"
                      >
                        <div className="flex items-center justify-end space-x-1">
                          {/* Copy Row Button */}
                          <button
                            onClick={e => handleCopySingleRow(e, item)}
                            className={`p-1 rounded transition-colors cursor-pointer ${
                              isJustCopied
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'text-slate-400 hover:text-slate-800 hover:bg-slate-100'
                            }`}
                            title={isJustCopied ? 'Copied to clipboard!' : 'Copy this row for Excel/Sheets'}
                          >
                            {isJustCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {item.isConsolidated ? (
                            <button
                              onClick={() => onOpenCancelEmailModal?.(item)}
                              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded text-[11px] transition-colors shadow-2xs cursor-pointer active:scale-95 flex items-center space-x-1"
                              title={`Draft cancel email listing all ${item.salesOrderCount} Sales Orders for SKU ${item.item}`}
                            >
                              <Mail className="w-3 h-3" />
                              <span>Cancel SO ({item.salesOrderCount})</span>
                            </button>
                          ) : item.isObsolete ? (
                            <button
                              onClick={() => onOpenCancelEmailModal?.(item)}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded text-[11px] transition-colors shadow-2xs cursor-pointer active:scale-95 flex items-center space-x-1"
                              title="Draft email notice to cancel sales order"
                            >
                              <Mail className="w-3 h-3" />
                              <span>Cancel SO</span>
                            </button>
                          ) : (
                            !item.isShippingOrNonInventory && (isNoWo || isConflict) && (
                              <button
                                onClick={() => onQuickCreateWo(item)}
                                className="px-2 py-1 bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold rounded text-[11px] transition-colors shadow-2xs cursor-pointer active:scale-95"
                                title="Create scheduled Work Order for this SKU"
                              >
                                + WO
                              </button>
                            )
                          )}
                          <button
                            onClick={() => onSelectItem(item)}
                            className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            title="View Details"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Constituent Orders Expandable Panel (when item is consolidated) */}
                    {isExpanded && item.constituentOrders && item.constituentOrders.length > 0 && (
                      <tr className="bg-rose-50/40 border-b border-rose-200/60">
                        <td colSpan={12} className="py-3 px-4">
                          <div className="rounded-lg border border-rose-200 bg-white p-3.5 shadow-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b border-rose-100">
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                                  <Boxes className="w-3.5 h-3.5 text-rose-600" />
                                  Constituent Orders for SKU <span className="font-mono text-rose-900 bg-rose-100 px-1.5 py-0.5 rounded">{item.item}</span>:
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  ({item.constituentOrders.length} order lines totaling {item.backOrderQty.toLocaleString()} units, ${(item.backOrderValueExGst).toFixed(2)} ex GST)
                                </span>
                              </div>
                              <button
                                onClick={() => onOpenCancelEmailModal?.(item)}
                                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-[10px] transition-colors cursor-pointer flex items-center space-x-1 shadow-2xs"
                              >
                                <Mail className="w-3 h-3" />
                                <span>Draft Combined Cancel Email ({item.salesOrderList?.length || item.constituentOrders.length} SOs)</span>
                              </button>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-[11px] border-collapse">
                                <thead>
                                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/80">
                                    <th className="py-1.5 px-2.5 font-semibold">SO #</th>
                                    <th className="py-1.5 px-2.5 font-semibold">Customer</th>
                                    <th className="py-1.5 px-2.5 font-semibold">Customer PO</th>
                                    <th className="py-1.5 px-2.5 font-semibold">Location</th>
                                    <th className="py-1.5 px-2.5 font-semibold text-right">BO Qty</th>
                                    <th className="py-1.5 px-2.5 font-semibold text-right">Order Value</th>
                                    <th className="py-1.5 px-2.5 font-semibold">Required Date</th>
                                    <th className="py-1.5 px-2.5 font-semibold text-center">Status</th>
                                    <th className="py-1.5 px-2.5 font-semibold text-right">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {item.constituentOrders.map((subOrder, subIdx) => (
                                    <tr key={`${subOrder.id}-${subIdx}`} className="hover:bg-rose-50/30 transition-colors">
                                      <td className="py-1.5 px-2.5 font-mono font-bold text-slate-900">{subOrder.documentNumber}</td>
                                      <td className="py-1.5 px-2.5 text-slate-800 font-medium">{subOrder.customerName}</td>
                                      <td className="py-1.5 px-2.5 text-slate-500">{subOrder.customerPo || '—'}</td>
                                      <td className="py-1.5 px-2.5 text-amber-900">
                                        <span className="bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 text-[10px] font-medium">
                                          📍 {subOrder.location || 'Unassigned'}
                                        </span>
                                      </td>
                                      <td className="py-1.5 px-2.5 text-right font-bold text-slate-900">{subOrder.backOrderQty.toLocaleString()}</td>
                                      <td className="py-1.5 px-2.5 text-right font-medium text-slate-800">${subOrder.backOrderValueExGst.toFixed(2)}</td>
                                      <td className="py-1.5 px-2.5 text-slate-600">{subOrder.supplyRequiredByDate || '—'}</td>
                                      <td className="py-1.5 px-2.5 text-center">
                                        {subOrder.cancellationStatus === 'CANCELLED' ? (
                                          <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 text-[9px] font-semibold border border-slate-300">
                                            SO Cancelled
                                          </span>
                                        ) : subOrder.cancellationStatus === 'EMAIL_SENT' ? (
                                          <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 text-[9px] font-semibold border border-blue-200">
                                            Email Sent
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 text-[9px] font-semibold border border-rose-200">
                                            Cancel Needed
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1.5 px-2.5 text-right">
                                        <button
                                          onClick={() => onOpenCancelEmailModal?.(subOrder)}
                                          className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 font-medium rounded text-[10px] transition-colors cursor-pointer"
                                          title={`Draft email for SO ${subOrder.documentNumber} only`}
                                        >
                                          Email SO
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-500 font-medium">
          Page <strong className="text-slate-900">{currentPage}</strong> of <strong className="text-slate-900">{totalPages}</strong> (showing {paginatedItems.length} of {filteredItems.length} items)
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 disabled:opacity-40 hover:bg-slate-100 flex items-center space-x-1 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Prev</span>
          </button>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 disabled:opacity-40 hover:bg-slate-100 flex items-center space-x-1 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
