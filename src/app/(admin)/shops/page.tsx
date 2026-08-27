"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ClientApiError } from "@/lib/client";
import { isValidCoordinate } from "@/lib/geo";
import { fileToShopsCsv } from "@/lib/sheet-file";
import type { GeocodeResultDto, ImportSummaryDto, Paginated, ShopDto } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { PageHeader } from "@/components/AppShell";

/* --------------------------------- Helpers -------------------------------- */

type StatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

interface GeocodeResponse {
  result: GeocodeResultDto | null;
  candidates?: GeocodeResultDto[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ClientApiError ? e.message : fallback;
}

/* ----------------------------- Shop form modal ----------------------------- */

interface ShopFormState {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  contactName: string;
  phone: string;
  email: string;
  externalRef: string;
  notes: string;
}

const emptyForm: ShopFormState = {
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  contactName: "",
  phone: "",
  email: "",
  externalRef: "",
  notes: "",
};

function ShopFormModal({
  open,
  shop,
  onClose,
  onSaved,
}: {
  open: boolean;
  shop: ShopDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<ShopFormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ShopFormState, string>>>({});
  const [locate, setLocate] = useState("");
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const lastResolvedRef = useRef("");

  useEffect(() => {
    if (!open) return;
    setForm(
      shop
        ? {
            name: shop.name,
            address: shop.address ?? "",
            latitude: String(shop.latitude),
            longitude: String(shop.longitude),
            contactName: shop.contactName ?? "",
            phone: shop.phone ?? "",
            email: shop.email ?? "",
            externalRef: shop.externalRef ?? "",
            notes: shop.notes ?? "",
          }
        : emptyForm,
    );
    setFieldErrors({});
    setLocate("");
    setDuplicateWarning(null);
    setSaving(false);
    setResolving(false);
    lastResolvedRef.current = "";
  }, [open, shop]);

  const set = (key: keyof ShopFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const resolveLocate = useCallback(async () => {
    const input = locate.trim();
    if (!input || input === lastResolvedRef.current || resolving) return;
    setResolving(true);
    try {
      const res = await api<GeocodeResponse>("/api/geocode", {
        method: "POST",
        body: JSON.stringify({ input }),
      });
      const hit = res.result ?? res.candidates?.[0] ?? null;
      if (hit) {
        lastResolvedRef.current = input;
        setForm((prev) => ({ ...prev, latitude: String(hit.lat), longitude: String(hit.lng) }));
        setFieldErrors((prev) => ({ ...prev, latitude: undefined, longitude: undefined }));
        toast("success", `Location resolved: ${hit.label}`);
      } else {
        toast("error", "Could not resolve that link or address");
      }
    } catch (e) {
      toast("error", errorMessage(e, "Could not resolve that link or address"));
    } finally {
      setResolving(false);
    }
  }, [locate, resolving, toast]);

  const validate = (): boolean => {
    const errors: Partial<Record<keyof ShopFormState, string>> = {};
    if (!form.name.trim()) errors.name = "Name is required";
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (form.latitude.trim() === "" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.latitude = "Latitude must be between -90 and 90";
    }
    if (form.longitude.trim() === "" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.longitude = "Longitude must be between -180 and 180";
    }
    if (!errors.latitude && !errors.longitude && !isValidCoordinate(lat, lng)) {
      errors.latitude = "Invalid coordinates";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const save = async (force: boolean) => {
    // Never build the payload from coordinates that a pasted Maps link is
    // still about to overwrite.
    if (resolving) {
      toast("info", "Wait a moment — the pasted location is still resolving");
      return;
    }
    if (!validate()) return;
    setSaving(true);
    setDuplicateWarning(null);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      contactName: form.contactName.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
      externalRef: form.externalRef.trim() || null,
    };
    try {
      if (shop) {
        await api<ShopDto>(`/api/shops/${shop.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast("success", "Shop updated");
      } else {
        await api<ShopDto>("/api/shops", {
          method: "POST",
          body: JSON.stringify(force ? { ...payload, force: true } : payload),
        });
        toast("success", "Shop created");
      }
      onSaved();
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 409) {
        setDuplicateWarning(e.message);
      } else {
        toast("error", errorMessage(e, "Failed to save shop"));
      }
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void save(false);
  };

  const onLocateKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void resolveLocate();
    }
  };

  return (
    <Modal open={open} title={shop ? "Edit shop" : "Add shop"} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" required error={fieldErrors.name}>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Shop name"
            autoFocus
          />
        </Field>

        <Field label="Address">
          <Input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Street, suburb, city"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Latitude" required error={fieldErrors.latitude}>
            <Input
              type="number"
              step="any"
              value={form.latitude}
              onChange={(e) => set("latitude", e.target.value)}
              placeholder="-37.81363"
            />
          </Field>
          <Field label="Longitude" required error={fieldErrors.longitude}>
            <Input
              type="number"
              step="any"
              value={form.longitude}
              onChange={(e) => set("longitude", e.target.value)}
              placeholder="144.96306"
            />
          </Field>
        </div>

        <Field label="Paste Google Maps link or lat,lng">
          <div className="flex items-center gap-2">
            <Input
              value={locate}
              onChange={(e) => setLocate(e.target.value)}
              onBlur={() => void resolveLocate()}
              onKeyDown={onLocateKeyDown}
              placeholder="https://maps.app.goo.gl/… or -37.81, 144.96"
              disabled={resolving}
            />
            {resolving && <span className="shrink-0 text-xs text-gray-500">Resolving…</span>}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Contact name">
            <Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="External ref">
            <Input
              value={form.externalRef}
              onChange={(e) => set("externalRef", e.target.value)}
              placeholder="Bill no / legacy id"
            />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        {duplicateWarning && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">{duplicateWarning}</p>
            <Button
              type="button"
              variant="secondary"
              loading={saving}
              onClick={() => void save(true)}
            >
              Save anyway
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={resolving}>
            {shop ? "Save changes" : "Create shop"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------- Import modal ------------------------------ */

function ImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<ImportSummaryDto | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setDragging(false);
    setUploading(false);
    setSummary(null);
  }, [open]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  const upload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      // Excel sheets (and CSVs with banner rows above the header, like
      // loading slips) are normalised to clean CSV before upload.
      const csv = await fileToShopsCsv(file);
      const payload = new File([csv], file.name.replace(/\.(xlsx|xls)$/i, ".csv"), {
        type: "text/csv",
      });
      const fd = new FormData();
      fd.append("file", payload);
      const result = await api<ImportSummaryDto>("/api/shops/import", {
        method: "POST",
        body: fd,
      });
      setSummary(result);
    } catch (e) {
      toast("error", errorMessage(e, "Import failed"));
    } finally {
      setUploading(false);
    }
  };

  const done = () => {
    onImported();
    onClose();
  };

  return (
    <Modal open={open} title="Import shops from Excel/CSV" onClose={summary ? done : onClose} wide>
      {!summary ? (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging
                ? "border-brand bg-brand-soft"
                : "border-gray-300 bg-gray-50 hover:border-brand/40 hover:bg-brand-soft/60"
            }`}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gray-400"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            {file ? (
              <p className="text-sm font-medium text-gray-900">{file.name}</p>
            ) : (
              <p className="text-sm text-gray-600">
                Drag and drop an .xlsx or .csv file here, or click to browse
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <p className="text-xs leading-relaxed text-gray-500">
            Flexible headers are supported: Name/Party, Latitude, Longitude, Address, Phone,
            Email, Bill No and Google Maps Link. When latitude or longitude is missing, the
            coordinates are recovered from the Google Maps link.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={() => void upload()} loading={uploading} disabled={!file}>
              Upload
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {summary.filename} · {summary.totalRows} rows processed
          </p>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {summary.imported} imported
          </div>

          {summary.skippedDuplicates > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {summary.skippedDuplicates} duplicates skipped
            </div>
          )}

          {summary.invalid > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-medium">{summary.invalid} invalid rows</p>
              {summary.errors.length > 0 && (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-red-700">
                  {summary.errors.map((err, i) => (
                    <li key={`${err.rowNumber}-${i}`}>
                      Row {err.rowNumber}: {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button onClick={done}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------- Screen --------------------------------- */

function ShopsScreen() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ACTIVE");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [reload, setReload] = useState(0);

  const [data, setData] = useState<Paginated<ShopDto> | null>(null);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShopDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShopDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  // Auto-open the import modal for /shops?import=1.
  useEffect(() => {
    if (searchParams.get("import") === "1") setImportOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      status,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    api<Paginated<ShopDto>>(`/api/shops?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) toast("error", errorMessage(e, "Failed to load shops"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, status, page, pageSize, reload, toast]);

  const closeImport = useCallback(() => {
    setImportOpen(false);
    if (searchParams.get("import")) router.replace("/shops");
  }, [router, searchParams]);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (shop: ShopDto) => {
    setEditing(shop);
    setFormOpen(true);
  };

  const toggleStatus = async (shop: ShopDto) => {
    if (busyId) return;
    setBusyId(shop.id);
    const next = shop.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api<ShopDto>(`/api/shops/${shop.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      toast("success", next === "ACTIVE" ? "Shop activated" : "Shop deactivated");
      refresh();
    } catch (e) {
      toast("error", errorMessage(e, "Failed to update shop status"));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/shops/${deleteTarget.id}`, { method: "DELETE" });
      toast("success", "Shop deleted");
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      toast("error", errorMessage(e, "Failed to delete shop"));
    } finally {
      setDeleting(false);
    }
  };

  const hasFilters = debouncedQ.trim().length > 0 || status !== "ACTIVE";
  const shops = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Shops"
        description="Manage delivery locations"
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button onClick={openAdd}>Add shop</Button>
          </>
        }
      />

      <div className="space-y-4">
        {/* Filter bar: search fills the row; compact filters sit on the right. */}
        <Card>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="flex-1">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, address, phone or ref…"
                aria-label="Search shops"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as StatusFilter);
                  setPage(1);
                }}
                className="w-28"
                aria-label="Status filter"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="ALL">All</option>
              </Select>
              <Select
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="w-32"
                aria-label="Page size"
              >
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </Select>
            </div>
          </div>
        </Card>

        {/* Table */}
        <Card padded={false}>
          {loading ? (
            <LoadingBlock label="Loading shops…" />
          ) : shops.length === 0 ? (
            hasFilters ? (
              <EmptyState
                title="No shops match your search"
                description="Try a different search term or status filter."
              />
            ) : (
              <EmptyState
                title="No shops yet"
                description="Import your shop list from a CSV file or add shops one by one."
                action={
                  <Button variant="secondary" onClick={() => setImportOpen(true)}>
                    Import CSV
                  </Button>
                }
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-5 py-2.5">Name</th>
                    <th className="px-3 py-2.5">Contact</th>
                    <th className="px-3 py-2.5">Coordinates</th>
                    <th className="px-3 py-2.5">Ref</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Updated</th>
                    <th className="px-5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((shop) => (
                    <tr key={shop.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900">{shop.name}</p>
                        {shop.address && (
                          <p className="mt-0.5 max-w-64 truncate text-xs text-gray-500">
                            {shop.address}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-700">
                        {shop.contactName || shop.phone ? (
                          <>
                            {shop.contactName && <p>{shop.contactName}</p>}
                            {shop.phone && (
                              <p className="mt-0.5 text-xs text-gray-500">{shop.phone}</p>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-600">
                        {shop.latitude.toFixed(5)}, {shop.longitude.toFixed(5)}
                      </td>
                      <td className="px-3 py-3 text-gray-700">{shop.externalRef ?? "—"}</td>
                      <td className="px-3 py-3">
                        <Badge value={shop.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-500">
                        {formatDate(shop.updatedAt)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button variant="ghost" className="!px-2 !py-1" onClick={() => openEdit(shop)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1"
                            loading={busyId === shop.id}
                            onClick={() => void toggleStatus(shop)}
                          >
                            {shop.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 !text-red-600 hover:!bg-red-50"
                            onClick={() => setDeleteTarget(shop)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && data && (
            <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />
          )}
        </Card>
      </div>

      <ShopFormModal
        open={formOpen}
        shop={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          refresh();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete shop?"}
        message="The shop is removed from lists; historical routes keep their data."
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ImportModal open={importOpen} onClose={closeImport} onImported={refresh} />
    </div>
  );
}

/* ----------------------------------- Page ---------------------------------- */

export default function ShopsPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading shops…" />}>
      <ShopsScreen />
    </Suspense>
  );
}
