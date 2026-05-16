import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Aguardando ativação',
};

export default function OnboardingPendingPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
          Conta criada · aguardando ativação
        </h1>
        <p className="mt-3 text-sm text-neutral-600">
          Sua conta foi autenticada com sucesso, mas seu perfil ainda não foi configurado pelo
          Admin Master. Aguarde a vinculação do seu papel e acesso às filiais.
        </p>
        <form action="/auth/logout" method="POST" className="mt-6">
          <button type="submit" className="btn-secondary">
            Sair
          </button>
        </form>
      </div>
    </main>
  );
}
