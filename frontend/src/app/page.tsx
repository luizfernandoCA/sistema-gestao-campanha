import { Hero } from '@/components/landing/Hero';
import { FeaturesGrid } from '@/components/landing/FeaturesGrid';
import { Architecture } from '@/components/landing/Architecture';
import { CTA } from '@/components/landing/CTA';
import { Footer } from '@/components/landing/Footer';
import { Nav } from '@/components/landing/Nav';

export default function LandingPage() {
  return (
    <main>
      <Nav />
      <Hero />
      <FeaturesGrid />
      <Architecture />
      <CTA />
      <Footer />
    </main>
  );
}
