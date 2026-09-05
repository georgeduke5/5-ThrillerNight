import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="font-heading text-2xl font-bold uppercase text-text">Admin Sign In</h1>
      <AdminLoginForm />
    </main>
  );
}
