import { Component, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Icon } from '../../components/icon/icon';
import { rememberAttribution, utmParams } from '../../services/attribution';
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

/**
 * TODO: replace with real customer quotes (with their permission) before launch. Until then each one is shown with a
 * visible "Sample" tag so nobody mistakes them for real reviews.
 */
const REVIEWS = [
  { quote: 'A short quote from a real customer about what changed for their team goes here.', name: 'Customer name', role: 'Role, Company', sample: true },
  { quote: 'A second quote, ideally mentioning a concrete result such as hours saved or projects delivered on time.', name: 'Customer name', role: 'Role, Company', sample: true },
  { quote: 'A third quote from a different kind of team, for example an agency or a freelancer.', name: 'Customer name', role: 'Role, Company', sample: true },
];

/** The public front page: what TooManyProjects is, real usage numbers, and the way into the free trial. */
@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, Icon],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.css',
})
export class LandingPage {
  private readonly api = inject(WorkspaceApi);
  private readonly route = inject(ActivatedRoute);
  /** Passed on to the sign-up links, so the campaign that brought the visitor is recorded with the account. */
  protected readonly utm = utmParams(this.route.snapshot.queryParams);
  protected readonly stats = rxResource({ stream: () => this.api.publicStats() });
  protected readonly REASONS = REASONS;
  protected readonly FEATURES = FEATURES;
  protected readonly REVIEWS = REVIEWS;
  protected readonly year = new Date().getFullYear();

  constructor() {
    rememberAttribution(this.route.snapshot.queryParams);
  }

  protected scrollTo(event: Event, id: string): void {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
