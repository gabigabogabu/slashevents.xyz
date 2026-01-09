import { Link } from "@/ui/router";

export function LandingPage() {
  return (
    <div className="grid min-h-screen w-full place-items-center p-4">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-6xl font-bold tracking-tight">slashevents.io</h1>
        <p>inspired by</p>
        <Link 
          to="https://blog.sequinstream.com/events-not-webhooks/"
          className="text-lg underline underline-offset-4 hover:text-primary transition-colors"
        >
          Give me /events, not webhooks
        </Link>
        <br></br>
        <Link
          to="/app"
          className="text-lg underline underline-offset-4 hover:text-primary transition-colors"
        >
          try it
        </Link>
        <Link
          to="/docs"
          className="text-lg underline underline-offset-4 hover:text-primary transition-colors"
        >
          api docs
        </Link>
      </div>
    </div>
  );
}


