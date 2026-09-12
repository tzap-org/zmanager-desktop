import { Laptop2, AlertTriangle } from "lucide-react";
import { InventorySection } from "./InventorySection";

export function DeviceTab() {
  return (
    <div className="grid gap-6">
      <InventorySection
        title="Device Administration"
        icon={<Laptop2 className="size-4 text-red-600 dark:text-red-400" />}
        empty=""
      >
        <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-1">
              <strong className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Device management lives in the hosted console
              </strong>
              <p className="text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                Device revocation is a server-side account operation that requires multi-factor
                verification. The desktop app does not perform that operation.
              </p>
              <p className="text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                Open <strong>Account → Devices</strong> in the hosted console to retire this
                device, then reopen this app to refresh its status. Archives, recipient keys, and
                local key material are unaffected either way.
              </p>
            </div>
          </div>

        </div>
      </InventorySection>
    </div>
  );
}
