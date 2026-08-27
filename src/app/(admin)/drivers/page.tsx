"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/AppShell";
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
  Select,
  useToast,
} from "@/components/ui";
import { api, ClientApiError } from "@/lib/client";
import type { DriverDto } from "@/lib/types";

/* ------------------------------ helpers ------------------------------ */

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function errorMessage(err: unknown): string {
  if (err instanceof ClientApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

/* ----------------------- credentials success view ---------------------- */

function CredentialsView({
  email,
  tempPassword,
  onDone,
}: {
  email: string;
  tempPassword: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Email: ${email}\nTemporary password: ${tempPassword}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm text-gray-900">
        <div className="flex justify-between gap-4">
          <span className="text-gray-500">Email</span>
          <span className="break-all">{email}</span>
        </div>
        <div className="mt-2 flex justify-between gap-4">
          <span className="text-gray-500">Temporary password</span>
          <span className="break-all font-semibold">{tempPassword}</span>
        </div>
      </div>
      <p className="text-xs font-medium text-amber-700">
        Shown only once — the driver must change it at first sign-in.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

/* ------------------------------- forms -------------------------------- */

interface DriverFormState {
  name: string;
  email: string;
  phone: string;
  password: string;
  status: string;
}

const emptyForm: DriverFormState = { name: "", email: "", phone: "", password: "", status: "ACTIVE" };

/* ------------------------------- sorting ------------------------------- */

type SortKey = "name" | "email" | "status" | "activeRoutes" | "lastLogin";

const SORT_ACCESSORS: Record<SortKey, (d: DriverDto) => string | number> = {
  name: (d) => d.name.toLowerCase(),
  email: (d) => d.email.toLowerCase(),
  status: (d) => d.status,
  activeRoutes: (d) => d.activeRouteCount ?? 0,
  // Missing timestamps sort as oldest so active drivers surface first on desc.
  lastLogin: (d) => (d.lastLoginAt ? new Date(d.lastLoginAt).getTime() : 0),
};

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={`px-5 py-3 font-medium ${className}`}>
      <button
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-800 ${
          active ? "text-gray-800" : ""
        }`}
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-0"}`}>
          {active && sort.dir === -1 ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

/* -------------------------------- page -------------------------------- */

export default function DriversPage() {
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<DriverDto[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  /** Search across name/email/phone, then sort by the active column. */
  const visibleDrivers = useMemo(() => {
    if (!drivers) return null;
    const q = query.trim().toLowerCase();
    const filtered = q
      ? drivers.filter(
          (d) =>
            d.name.toLowerCase().includes(q) ||
            d.email.toLowerCase().includes(q) ||
            (d.phone ?? "").toLowerCase().includes(q),
        )
      : drivers;
    const accessor = SORT_ACCESSORS[sort.key];
    return [...filtered].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [drivers, query, sort]);

  // Add modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<DriverFormState>(emptyForm);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [addBusy, setAddBusy] = useState(false);
  const [addCreds, setAddCreds] = useState<{ email: string; tempPassword: string } | null>(null);

  // Edit modal
  const [editTarget, setEditTarget] = useState<DriverDto | null>(null);
  const [editForm, setEditForm] = useState<DriverFormState>(emptyForm);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editBusy, setEditBusy] = useState(false);

  // Reset credentials
  const [resetTarget, setResetTarget] = useState<DriverDto | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetCreds, setResetCreds] = useState<{ email: string; tempPassword: string } | null>(null);

  // Remove
  const [removeTarget, setRemoveTarget] = useState<DriverDto | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // Per-row status toggle
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: DriverDto[] }>("/api/drivers");
      setDrivers(res.items);
    } catch (err) {
      setDrivers([]);
      toast("error", errorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------ add ------------------------------ */

  const openAdd = () => {
    setAddForm(emptyForm);
    setAddErrors({});
    setAddCreds(null);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const errors: Record<string, string> = {};
    if (!addForm.name.trim()) errors.name = "Name is required";
    if (!addForm.email.trim()) errors.email = "Email is required";
    if (addForm.password && addForm.password.length < 8) {
      errors.password = "Password must be at least 8 characters";
    }
    setAddErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setAddBusy(true);
    try {
      const res = await api<{ driver: DriverDto; tempPassword?: string }>("/api/drivers", {
        method: "POST",
        body: JSON.stringify({
          name: addForm.name.trim(),
          email: addForm.email.trim(),
          phone: addForm.phone.trim() || null,
          ...(addForm.password ? { password: addForm.password } : {}),
        }),
      });
      toast("success", `Driver ${res.driver.name} created`);
      void load();
      if (res.tempPassword) {
        setAddCreds({ email: res.driver.email, tempPassword: res.tempPassword });
      } else {
        setAddOpen(false);
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setAddBusy(false);
    }
  };

  /* ------------------------------ edit ------------------------------ */

  const openEdit = (driver: DriverDto) => {
    setEditForm({
      name: driver.name,
      email: driver.email,
      phone: driver.phone ?? "",
      password: "",
      status: driver.status,
    });
    setEditErrors({});
    setEditTarget(driver);
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    const errors: Record<string, string> = {};
    if (!editForm.name.trim()) errors.name = "Name is required";
    if (!editForm.email.trim()) errors.email = "Email is required";
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setEditBusy(true);
    try {
      await api<DriverDto>(`/api/drivers/${editTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          email: editForm.email.trim(),
          phone: editForm.phone.trim() || null,
          status: editForm.status,
        }),
      });
      toast("success", "Driver updated");
      setEditTarget(null);
      void load();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setEditBusy(false);
    }
  };

  /* ------------------------- reset credentials ------------------------ */

  const confirmReset = async () => {
    if (!resetTarget) return;
    setResetBusy(true);
    try {
      const res = await api<{ tempPassword: string }>(
        `/api/drivers/${resetTarget.id}/reset-credentials`,
        { method: "POST" },
      );
      setResetCreds({ email: resetTarget.email, tempPassword: res.tempPassword });
      toast("success", "Credentials reset");
      setResetTarget(null);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setResetBusy(false);
    }
  };

  /* --------------------------- status toggle -------------------------- */

  const toggleStatus = async (driver: DriverDto) => {
    const next = driver.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setTogglingId(driver.id);
    try {
      await api<DriverDto>(`/api/drivers/${driver.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      toast("success", next === "ACTIVE" ? `${driver.name} activated` : `${driver.name} deactivated`);
      void load();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setTogglingId(null);
    }
  };

  /* ------------------------------ remove ------------------------------ */

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      await api<{ ok: boolean }>(`/api/drivers/${removeTarget.id}`, { method: "DELETE" });
      toast("success", `Driver ${removeTarget.name} removed`);
      setRemoveTarget(null);
      void load();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setRemoveBusy(false);
    }
  };

  /* ------------------------------ render ------------------------------ */

  return (
    <div>
      <PageHeader
        title="Drivers"
        description="Manage driver accounts and credentials."
        actions={<Button onClick={openAdd}>Add driver</Button>}
      />

      <Card padded={false}>
        {drivers !== null && drivers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 border-b border-gray-100 px-5 py-3.5">
            <div className="w-full min-w-40 sm:w-64">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search drivers…"
                aria-label="Search drivers by name, email or phone"
              />
            </div>
            {query && (
              <button
                className="text-xs font-medium text-gray-500 hover:text-gray-800 hover:underline"
                onClick={() => setQuery("")}
              >
                Clear
              </button>
            )}
            {visibleDrivers && (
              <span className="ml-auto text-xs text-gray-400">
                {visibleDrivers.length} of {drivers.length} driver{drivers.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
        {drivers === null || visibleDrivers === null ? (
          <LoadingBlock label="Loading drivers…" />
        ) : drivers.length === 0 ? (
          <EmptyState
            title="No drivers yet"
            description="Add your first driver to start assigning routes."
            action={<Button onClick={openAdd}>Add driver</Button>}
          />
        ) : visibleDrivers.length === 0 ? (
          <EmptyState
            title="No drivers match"
            description="Try a different search."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                  <SortableTh label="Name" sortKey="name" sort={sort} onSort={onSort} />
                  <SortableTh label="Email" sortKey="email" sort={sort} onSort={onSort} />
                  <SortableTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
                  <SortableTh
                    label="Active routes"
                    sortKey="activeRoutes"
                    sort={sort}
                    onSort={onSort}
                  />
                  <SortableTh label="Last login" sortKey="lastLogin" sort={sort} onSort={onSort} />
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleDrivers.map((driver) => (
                  <tr key={driver.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{driver.name}</div>
                      {driver.phone && <div className="text-xs text-gray-500">{driver.phone}</div>}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{driver.email}</td>
                    <td className="px-5 py-3">
                      <Badge value={driver.status} />
                    </td>
                    <td className="px-5 py-3 text-gray-600">{driver.activeRouteCount ?? 0}</td>
                    <td className="px-5 py-3 text-gray-600">{relativeTime(driver.lastLoginAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => openEdit(driver)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setResetTarget(driver)}>
                          Reset credentials
                        </Button>
                        <Button
                          variant="ghost"
                          loading={togglingId === driver.id}
                          onClick={() => toggleStatus(driver)}
                        >
                          {driver.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50"
                          onClick={() => setRemoveTarget(driver)}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add driver modal */}
      <Modal
        open={addOpen}
        title={addCreds ? "Driver created" : "Add driver"}
        onClose={() => setAddOpen(false)}
      >
        {addCreds ? (
          <CredentialsView
            email={addCreds.email}
            tempPassword={addCreds.tempPassword}
            onDone={() => setAddOpen(false)}
          />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdd();
            }}
          >
            <Field label="Name" required error={addErrors.name}>
              <Input
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
                autoFocus
              />
            </Field>
            <Field label="Email" required error={addErrors.email}>
              <Input
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="driver@example.com"
              />
            </Field>
            <Field label="Phone" error={addErrors.phone}>
              <Input
                value={addForm.phone}
                onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Optional"
              />
            </Field>
            <Field label="Password" error={addErrors.password}>
              <Input
                type="password"
                value={addForm.password}
                onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Optional"
                autoComplete="new-password"
              />
              <p className="text-xs text-gray-500">
                Leave blank to auto-generate a temporary password.
              </p>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={addBusy}>
                Create driver
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Edit driver modal */}
      <Modal open={editTarget !== null} title="Edit driver" onClose={() => setEditTarget(null)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submitEdit();
          }}
        >
          <Field label="Name" required error={editErrors.name}>
            <Input
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Email" required error={editErrors.email}>
            <Input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={editForm.phone}
              onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="Optional"
            />
          </Field>
          <Field label="Status">
            <Select
              value={editForm.status}
              onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={editBusy}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reset credentials confirmation */}
      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset credentials"
        message={
          resetTarget
            ? `Generates a new temporary password for ${resetTarget.name} and signs the driver out everywhere.`
            : ""
        }
        confirmLabel="Reset credentials"
        loading={resetBusy}
        onConfirm={() => void confirmReset()}
        onCancel={() => setResetTarget(null)}
      />

      {/* Reset credentials result */}
      <Modal
        open={resetCreds !== null}
        title="New credentials"
        onClose={() => setResetCreds(null)}
      >
        {resetCreds && (
          <CredentialsView
            email={resetCreds.email}
            tempPassword={resetCreds.tempPassword}
            onDone={() => setResetCreds(null)}
          />
        )}
      </Modal>

      {/* Remove confirmation */}
      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove driver"
        message={
          removeTarget
            ? `Removes the driver account for ${removeTarget.name}. Unstarted assigned routes return to Draft; history is kept.`
            : ""
        }
        confirmLabel="Remove"
        danger
        loading={removeBusy}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
