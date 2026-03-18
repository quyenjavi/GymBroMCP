import LoginForm from "./ui/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">GymBro MCP</h1>
          <p className="mt-2 text-sm text-zinc-400">Login to start training.</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

