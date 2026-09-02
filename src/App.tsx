import React, { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { BackOrderItem, WorkOrder, GlobalFilterState, MainExtractRecord } from './types';
import { INITIAL_BACKORDER_CSV, INITIAL_WORKORDER_CSV, INITIAL_MAIN_EXTRACT_CSV } from './data/initialCsvData';
import { parseBackOrderCsv, parseWorkOrderCsv, parseMainExtractCsv, exportBackOrdersToCsv, ensureDate } from './utils/csvParser';
import { analyzeBackOrders, generateAnalysisSummary } from './utils/analysisEngine';
import { Header } from './components/Header';
import { GlobalFilterBar } from './components/GlobalFilterBar';
import { SummaryCards } from './components/SummaryCards';
import { ConflictAlerts } from './components/ConflictAlerts';
import { BackOrderTable } from './components/BackOrderTable';
import { WorkOrdersManager } from './components/WorkOrdersManager';
import { TimelineGanttView } from './components/TimelineGanttView';
import { CsvUploaderModal } from './components/CsvUploaderModal';
import { ItemDetailModal } from './components/ItemDetailModal';
import { CancelOrderEmailModal } from './components/CancelOrderEmailModal';

const STORAGE_KEY_BACKORDERS = 'backorder_analyzer_raw_bo_v2';
const STORAGE_KEY_WORKORDERS = 'backorder_analyzer_work_orders_v2';
const STORAGE_KEY_MAIN_EXTRACT = 'backorder_analyzer_main_extract_v2';
const STORAGE_KEY_LAST_SAVED = 'backorder_analyzer_last_saved_v2';

export default function App() {
  // Local storage state flags
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_LAST_SAVED);
  });

  const [isCustomData, setIsCustomData] = useState<boolean>(() => {
    return !!(
      localStorage.getItem(STORAGE_KEY_BACKORDERS) ||
      localStorage.getItem(STORAGE_KEY_WORKORDERS) ||
      localStorage.getItem(STORAGE_KEY_MAIN_EXTRACT)
    );
  });

  // 1. Raw Data States (Initialized from local storage if available)
  const [rawBackOrders, setRawBackOrders] = useState<Partial<BackOrderItem>[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BACKORDERS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to initial demo dataset
    }
    return parseBackOrderCsv(INITIAL_BACKORDER_CSV);
  });

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_WORKORDERS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to initial demo dataset
    }
    return parseWorkOrderCsv(INITIAL_WORKORDER_CSV);
  });

  const [mainExtractRecords, setMainExtractRecords] = useState<MainExtractRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_MAIN_EXTRACT);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to initial demo dataset
    }
    return parseMainExtractCsv(INITIAL_MAIN_EXTRACT_CSV);
  });

  // Auto-save state changes locally in browser
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_BACKORDERS, JSON.stringify(rawBackOrders));
      localStorage.setItem(STORAGE_KEY_WORKORDERS, JSON.stringify(workOrders));
      localStorage.setItem(STORAGE_KEY_MAIN_EXTRACT, JSON.stringify(mainExtractRecords));
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      localStorage.setItem(STORAGE_KEY_LAST_SAVED, timeStr);
      setLastSavedTime(timeStr);
    } catch {
      // Ignore quota errors
    }
  }, [rawBackOrders, workOrders, mainExtractRecords]);

  // 2. Global Filter State (Location, Brand, Item Type & Cutoff Date)
  const [globalFilters, setGlobalFilters] = useState<GlobalFilterState>({
    location: 'ALL',
    brand: 'ALL',
    itemType: 'ALL',
    cutoffDate: null
  });

  // Table filter status synced when clicking Obsolete KPI card
  const [tableFilterStatus, setTableFilterStatus] = useState<string | undefined>(undefined);

  // 3. Active Tab State
  const [activeTab, setActiveTab] = useState<'backorders' | 'workorders' | 'timeline' | 'conflicts'>('backorders');

  // 4. Modal & Notification States
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [uploaderTarget, setUploaderTarget] = useState<'backorders' | 'workorders' | 'main_extract'>('backorders');
  const [selectedItem, setSelectedItem] = useState<BackOrderItem | null>(null);

  // Cancellation Email Modal State
  const [cancelModalState, setCancelModalState] = useState<{
    isOpen: boolean;
    items: BackOrderItem[];
  }>({
    isOpen: false,
    items: []
  });

  const [toast, setToast] = useState<{
    id: number;
    title: string;
    message: string;
  } | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 5. Derived Analyzed Data (All vs Filtered by Location, Type & Date Slider)
  const allAnalyzedItems = useMemo(() => {
    return analyzeBackOrders(rawBackOrders, workOrders, mainExtractRecords);
  }, [rawBackOrders, workOrders, mainExtractRecords]);

  const filteredAnalyzedItems = useMemo(() => {
    return allAnalyzedItems.filter(item => {
      // Location filter
      if (globalFilters.location !== 'ALL') {
        const itemLoc = item.location ? item.location.trim() : 'Unassigned';
        if (itemLoc !== globalFilters.location) return false;
      }

      // Brand filter
      if (globalFilters.brand !== 'ALL') {
        const itemBrand = item.brand ? item.brand.trim() : 'Unassigned';
        if (itemBrand !== globalFilters.brand) return false;
      }

      // Item Type filter
      if (globalFilters.itemType !== 'ALL') {
        const itemTypeStr = (item.typeCategory || item.classCategory || 'Standard').trim();
        if (itemTypeStr !== globalFilters.itemType) return false;
      }

      // Cutoff Date filter (required on or before cutoff date)
      if (globalFilters.cutoffDate && item.supplyRequiredDateParsed) {
        const cutoffMs = new Date(globalFilters.cutoffDate).getTime();
        const itemDate = item.supplyRequiredDateParsed instanceof Date
          ? item.supplyRequiredDateParsed
          : ensureDate(item.supplyRequiredDateParsed);
        if (itemDate && itemDate.getTime() > cutoffMs) return false;
      }

      return true;
    });
  }, [allAnalyzedItems, globalFilters]);

  const summary = useMemo(() => {
    return generateAnalysisSummary(filteredAnalyzedItems);
  }, [filteredAnalyzedItems]);

  const totalConflictsCount = useMemo(() => {
    return filteredAnalyzedItems.filter(
      i => !i.isShippingOrNonInventory && (
        i.conflictStatus === 'NO_WORK_ORDER' ||
        i.conflictStatus === 'SCHEDULE_CONFLICT' ||
        i.conflictStatus === 'QUANTITY_SHORTAGE'
      )
    ).length;
  }, [filteredAnalyzedItems]);

  // Handlers
  const handleUpdateGlobalFilters = (updated: Partial<GlobalFilterState>) => {
    setGlobalFilters(prev => ({ ...prev, ...updated }));
  };

  const handleResetGlobalFilters = () => {
    setGlobalFilters({
      location: 'ALL',
      brand: 'ALL',
      itemType: 'ALL',
      cutoffDate: null
    });
  };

  // Open single item cancellation email modal (aggregates all SOs for this SKU)
  const handleOpenCancelEmailModal = (item: BackOrderItem) => {
    // If it's already a consolidated item, unpack its constituent orders
    if (item.constituentOrders && item.constituentOrders.length > 0) {
      setCancelModalState({
        isOpen: true,
        items: item.constituentOrders
      });
      return;
    }

    // If it's an obsolete item, find all matching backorders with the same SKU
    // so the email automatically includes the Item Number and ALL associated SO numbers!
    if (item.isObsolete) {
      const allOrdersForSku = allAnalyzedItems.filter(
        b => b.isObsolete && b.item.trim().toLowerCase() === item.item.trim().toLowerCase()
      );
      if (allOrdersForSku.length > 0) {
        setCancelModalState({
          isOpen: true,
          items: allOrdersForSku
        });
        return;
      }
    }

    setCancelModalState({
      isOpen: true,
      items: [item]
    });
  };

  // Open batch cancellation email modal
  const handleBatchCancelModal = (items: BackOrderItem[]) => {
    setCancelModalState({
      isOpen: true,
      items
    });
  };

  // Confirm cancellation status update
  const handleConfirmCancellation = (
    orderIds: string[],
    newStatus: 'EMAIL_SENT' | 'CANCELLED',
    notes?: string
  ) => {
    const today = new Date().toLocaleDateString('en-AU');
    setRawBackOrders(prev =>
      prev.map(item => {
        if (orderIds.includes(item.id || '')) {
          return {
            ...item,
            cancellationStatus: newStatus,
            cancellationDate: today,
            cancellationNotes: notes
          };
        }
        return item;
      })
    );

    setToast({
      id: Date.now(),
      title: newStatus === 'CANCELLED' ? 'Sales Order Cancelled' : 'Cancellation Email Logged',
      message: `${orderIds.length} obsolete item backorder line(s) marked as ${
        newStatus === 'CANCELLED' ? 'Cancelled in ERP' : 'Email Sent to Sales/Customer'
      }.`
    });
  };

  // CSV Import Handler supporting all 3 datasets
  const handleImportCsvs = (data: {
    backordersCsv?: string;
    workordersCsv?: string;
    mainExtractCsv?: string;
  }): {
    success: boolean;
    backordersCount?: number;
    workordersCount?: number;
    mainExtractCount?: number;
    error?: string;
  } => {
    let boCount = 0;
    let woCount = 0;
    let meCount = 0;
    let parsedBo = null;
    let parsedWo = null;
    let parsedMe = null;

    if (data.backordersCsv && data.backordersCsv.trim()) {
      parsedBo = parseBackOrderCsv(data.backordersCsv);
      if (parsedBo.length === 0) {
        return {
          success: false,
          error: 'Could not parse any valid records from the Backorder Report CSV. Please check file columns.'
        };
      }
      boCount = parsedBo.length;
    }

    if (data.workordersCsv && data.workordersCsv.trim()) {
      parsedWo = parseWorkOrderCsv(data.workordersCsv);
      if (parsedWo.length === 0) {
        return {
          success: false,
          error: 'Could not parse any valid records from the Work Orders CSV. Please check file columns.'
        };
      }
      woCount = parsedWo.length;
    }

    if (data.mainExtractCsv && data.mainExtractCsv.trim()) {
      parsedMe = parseMainExtractCsv(data.mainExtractCsv);
      if (parsedMe.length === 0) {
        return {
          success: false,
          error: 'Could not parse any valid records from the Main Extract CSV. Please check file columns.'
        };
      }
      meCount = parsedMe.length;
    }

    if (!parsedBo && !parsedWo && !parsedMe) {
      return { success: false, error: 'No CSV data provided to import.' };
    }

    if (parsedBo) setRawBackOrders(parsedBo);
    if (parsedWo) setWorkOrders(parsedWo);
    if (parsedMe) setMainExtractRecords(parsedMe);

    setIsCustomData(true);
    setActiveTab('backorders');

    const descList = [
      parsedBo ? `${boCount} backorders` : null,
      parsedWo ? `${woCount} work orders` : null,
      parsedMe ? `${meCount} main extract records` : null
    ].filter(Boolean);

    setToast({
      id: Date.now(),
      title: 'Datasets Successfully Updated!',
      message: `Loaded: ${descList.join(' + ')}.`
    });

    return {
      success: true,
      backordersCount: boCount,
      workordersCount: woCount,
      mainExtractCount: meCount
    };
  };

  const handleImportCsv = (csvText: string, targetType: 'backorders' | 'workorders' | 'main_extract'): boolean => {
    if (targetType === 'backorders') {
      return handleImportCsvs({ backordersCsv: csvText }).success;
    } else if (targetType === 'workorders') {
      return handleImportCsvs({ workordersCsv: csvText }).success;
    } else {
      return handleImportCsvs({ mainExtractCsv: csvText }).success;
    }
  };

  const handleAddWorkOrder = (newWo: Omit<WorkOrder, 'id'>) => {
    const created: WorkOrder = {
      ...newWo,
      id: `wo-custom-${Date.now()}-${Math.random()}`
    };
    setWorkOrders(prev => [created, ...prev]);
  };

  const handleDeleteWorkOrder = (id: string) => {
    setWorkOrders(prev => prev.filter(w => w.id !== id));
  };

  const handleQuickCreateWo = (item: BackOrderItem) => {
    const defaultDate = item.supplyRequiredByDate || '15/08/2026';
    const newWo: Omit<WorkOrder, 'id'> = {
      woNumber: `WO-${Math.floor(1000 + Math.random() * 9000)}`,
      item: item.item.trim().toUpperCase(),
      scheduledQty: item.backOrderQty || 100,
      scheduledDate: defaultDate,
      scheduledDateParsed: item.supplyRequiredDateParsed,
      status: 'Planned',
      workCenter: 'Assembly Line 1',
      notes: `Quick created for BO Doc ${item.documentNumber} (${item.customerName})`
    };
    handleAddWorkOrder(newWo);
  };

  const handleResetData = () => {
    if (window.confirm('Reset backorder report, work orders, and main extract datasets back to original sample data?')) {
      try {
        localStorage.removeItem(STORAGE_KEY_BACKORDERS);
        localStorage.removeItem(STORAGE_KEY_WORKORDERS);
        localStorage.removeItem(STORAGE_KEY_MAIN_EXTRACT);
        localStorage.removeItem(STORAGE_KEY_LAST_SAVED);
      } catch {
        // Ignore storage errors
      }
      setIsCustomData(false);
      setLastSavedTime(null);
      setTableFilterStatus(undefined);
      setRawBackOrders(parseBackOrderCsv(INITIAL_BACKORDER_CSV));
      setWorkOrders(parseWorkOrderCsv(INITIAL_WORKORDER_CSV));
      setMainExtractRecords(parseMainExtractCsv(INITIAL_MAIN_EXTRACT_CSV));
      setToast({
        id: Date.now(),
        title: 'Dataset Reset',
        message: 'Restored original sample backorders, work orders, and main extract datasets.'
      });
    }
  };

  const handleExportCsv = () => {
    const csvStr = exportBackOrdersToCsv(filteredAnalyzedItems);
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Backorder_Conflict_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSummaryCardFilterClick = (filterType: string) => {
    if (filterType === 'CRITICAL' || filterType === 'CONFLICTS') {
      setActiveTab('conflicts');
    } else if (filterType === 'OBSOLETE') {
      setTableFilterStatus('OBSOLETE');
      setActiveTab('backorders');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans antialiased relative">
      {/* Success Completion Toast Notification */}
      {toast && (
        <div className="fixed top-20 right-4 sm:right-8 z-50 max-w-sm w-full bg-slate-900 text-white rounded-2xl shadow-2xl p-4 border border-emerald-500/40 flex items-start space-x-3 animate-in slide-in-from-top-4 fade-in duration-200">
          <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-white tracking-tight">{toast.title}</h4>
              <span className="text-[10px] text-emerald-400 font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">Complete</span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">{toast.message}</p>
          </div>
          <button
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation & Actions Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenUploadModal={() => {
          setIsUploaderOpen(true);
        }}
        onOpenAddWoModal={() => setActiveTab('workorders')}
        onResetData={handleResetData}
        onExportCsv={handleExportCsv}
        totalConflictsCount={totalConflictsCount}
        lastSavedTime={lastSavedTime}
        isCustomData={isCustomData}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Global Location & Cutoff Date Slider Bar */}
        <GlobalFilterBar
          items={allAnalyzedItems}
          filters={globalFilters}
          onFilterChange={handleUpdateGlobalFilters}
          onResetGlobalFilters={handleResetGlobalFilters}
        />

        {/* KPI Dashboard Metrics */}
        <SummaryCards
          summary={summary}
          onFilterClick={handleSummaryCardFilterClick}
        />

        {/* Tab Views */}
        {activeTab === 'backorders' && (
          <BackOrderTable
            items={filteredAnalyzedItems}
            onSelectItem={setSelectedItem}
            onQuickCreateWo={handleQuickCreateWo}
            onOpenCancelEmailModal={handleOpenCancelEmailModal}
            onBatchCancelModal={handleBatchCancelModal}
            globalLocation={globalFilters.location}
            globalBrand={globalFilters.brand}
            globalItemType={globalFilters.itemType}
            globalCutoffDate={globalFilters.cutoffDate}
            initialFilterStatus={tableFilterStatus}
          />
        )}

        {activeTab === 'conflicts' && (
          <ConflictAlerts
            items={filteredAnalyzedItems}
            workOrders={workOrders}
            onQuickCreateWo={handleQuickCreateWo}
            onSelectItem={setSelectedItem}
            onOpenCancelEmailModal={handleOpenCancelEmailModal}
          />
        )}

        {activeTab === 'timeline' && (
          <TimelineGanttView
            items={filteredAnalyzedItems}
            workOrders={workOrders}
            onSelectItem={setSelectedItem}
          />
        )}

        {activeTab === 'workorders' && (
          <WorkOrdersManager
            workOrders={workOrders}
            onAddWorkOrder={handleAddWorkOrder}
            onDeleteWorkOrder={handleDeleteWorkOrder}
            onOpenUploadModal={() => {
              setUploaderTarget('workorders');
              setIsUploaderOpen(true);
            }}
          />
        )}
      </main>

      {/* Application Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white/70 py-4 px-4 sm:px-6 lg:px-8 text-xs text-slate-500">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-800">Backorder &amp; Production Conflict Analyzer V2</span>
            <span className="px-1.5 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 rounded font-mono text-[10px] font-bold">v2.0.0</span>
          </div>
          <p className="text-slate-400 text-[11px]">
            Browser-persisted storage • Automated CSV Backorder Parsing &amp; Work Order Conflict Intelligence
          </p>
        </div>
      </footer>

      {/* CSV Uploader Modal */}
      <CsvUploaderModal
        isOpen={isUploaderOpen}
        onClose={() => setIsUploaderOpen(false)}
        targetType={uploaderTarget}
        onImportCsvs={handleImportCsvs}
        onImportCsv={handleImportCsv}
      />

      {/* Single Item Analysis Modal */}
      <ItemDetailModal
        item={selectedItem}
        workOrders={workOrders}
        onClose={() => setSelectedItem(null)}
        onQuickCreateWo={handleQuickCreateWo}
        onOpenCancelEmailModal={handleOpenCancelEmailModal}
      />

      {/* Cancel Sales Order Email Notice Modal */}
      <CancelOrderEmailModal
        isOpen={cancelModalState.isOpen}
        onClose={() => setCancelModalState({ isOpen: false, items: [] })}
        items={cancelModalState.items}
        onConfirmCancellation={handleConfirmCancellation}
      />
    </div>
  );
}
