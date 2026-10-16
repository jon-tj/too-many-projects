import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { Stars } from '../../components/stars/stars';
import { rememberAttribution, utmParams } from '../../services/attribution';
import { PLAN_OPTIONS, PlanOption, perPersonPrice, shownPrice } from '../../services/plans';
import { WorkspaceApi } from '../../services/workspace-api';

const REASONS = [
  {
    icon: 'dashboard_customize',
    title: 'One tool instead of five',
    text: 'Boards, roadmaps with a critical path, whiteboard canvases, time tracking and client billing live in the same place, so nothing falls between tools.',
  },
  {
    icon: 'smart_toy',
    title: 'Built for working with AI',
    text: 'Copy tasks straight into your AI assistant today. Agents that pick up tasks and report back on their own are on the way.',
    soon: true,
  },
  {
    icon: 'savings',
    title: 'Priced for small businesses',
    text: 'Made for teams of a handful, not enterprises. No consultants, no lengthy setup: start free and decide after 30 days.',
  },
  {
    icon: 'trending_up',
    title: 'Productivity you can see',
    text: 'Hours tracked and tasks completed per project show whether the team is getting more done, week after week.',
  },
];

const FEATURES = [
  { icon: 'grid_view', title: 'Boards', text: 'Drag tasks from to do to done, split them into units and see what is blocked at a glance.' },
  { icon: 'view_timeline', title: 'Roadmap', text: 'Dependencies laid out on a timeline, with the critical path marked for you.' },
  { icon: 'account_tree', title: 'Canvas', text: 'A shared whiteboard for sketches, notes and images, with tasks pinned where they belong.' },
  { icon: 'schedule', title: 'Time tracking', text: 'One click to start working. Every hour lands in your work log and on the project.' },
  { icon: 'receipt_long', title: 'Client billing', text: 'Monthly reports and bills from the hours you tracked, with daily minimums and maximums.' },
  { icon: 'group', title: 'Made for teams', text: 'Invite people by email, assign work and see who is working on what.' },
];

/** The public front page: what TooManyProjects is, real usage numbers, what it costs, and the way into the free trial. */
@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, Icon, Avatar, Stars, DatePipe],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.css',
})
export class LandingPage {
  private readonly api = inject(WorkspaceApi);
  private readonly route = inject(ActivatedRoute);
  /** Passed on to the sign-up links, so the campaign that brought the visitor is recorded with the account. */
  protected readonly utm = utmParams(this.route.snapshot.queryParams);
  protected readonly stats = rxResource({ stream: () => this.api.publicStats() });
  protected readonly PLANS = PLAN_OPTIONS;
  /** Prices from Stripe; plans missing from it (or all of them, when loading fails) show their fallback. */
  private readonly prices = rxResource({ stream: () => this.api.planPrices() });

  protected price(option: PlanOption) {
    return shownPrice(option, this.prices.error() ? [] : this.prices.value());
  }

  /** The team the pricing note works the cost out for: Plus split between five people. */
  protected readonly TEAM_SIZE = 5;
  protected readonly teamShare = computed(() =>
    perPersonPrice(
      PLAN_OPTIONS.find((option) => option.name === 'plus')!,
      this.prices.error() ? [] : this.prices.value(),
      this.TEAM_SIZE,
    ),
  );
  protected readonly REASONS = REASONS;
  protected readonly FEATURES = FEATURES;
  /** Reviews the admin chose; the section and its link are hidden while there are none. */
  protected readonly reviews = rxResource({ stream: () => this.api.publicReviews() });
  protected readonly hasReviews = computed(() => (this.reviews.value()?.length ?? 0) > 0);
  protected readonly year = new Date().getFullYear();

  constructor() {
    rememberAttribution(this.route.snapshot.queryParams);
  }

  protected scrollTo(event: Event, id: string): void {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
