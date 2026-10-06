import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { debounceTime, of, switchMap } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Modal } from '../../../components/modal/modal';
import { ProjectMember, ProjectRole, UserSummary } from '../../../services/models';
import { WorkspaceApi } from '../../../services/workspace-api';
import { ProjectPage } from '../project-page';

@Component({
  selector: 'app-project-members',
  imports: [ReactiveFormsModule, Icon, Modal],
  templateUrl: './project-members.html',
  styleUrl: './project-members.css',
})
export class ProjectMembers {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  private readonly project = inject(ProjectPage).project;
  protected readonly members = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.projectMembers(params),
    defaultValue: [],
  });
  private readonly account = rxResource({ stream: () => this.api.currentAccount() });
  protected readonly isOwner = computed(() =>
    this.members.value().some((member) => member.userId === this.account.value()?.id && member.role === 'Owner'),
  );

  protected readonly adding = signal(false);
  protected readonly error = signal('');
  protected readonly removalError = signal('');
  protected readonly removingUserId = signal<string | null>(null);
  protected readonly created = signal<{ userName: string; email: string } | null>(null);
  protected readonly role = new FormControl<ProjectRole>('Developer', { nonNullable: true });
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly candidates = toSignal(
    this.search.valueChanges.pipe(
      debounceTime(250),
      switchMap((term) =>
        term.trim().length < 2 ? of([]) : this.api.memberCandidates(this.projectId(), term.trim()),
      ),
    ),
    { initialValue: [] },
  );
  protected readonly newUser = inject(FormBuilder).nonNullable.group({
    userName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(64)]],
    email: ['', [Validators.required, Validators.email]],
  });

  protected openAdd(): void {
    this.role.setValue('Developer');
    this.search.setValue('');
    this.newUser.reset();
    this.created.set(null);
    this.error.set('');
    this.adding.set(true);
  }

  protected addExisting(user: UserSummary): void {
    this.api.addMember(this.projectId(), user.id, this.role.value).subscribe({
      next: (member) => {
        this.added(member);
        this.adding.set(false);
      },
      error: (error: HttpErrorResponse) => this.error.set(error.error?.error ?? 'Could not add the member.'),
    });
  }

  protected addNewUser(): void {
    if (this.newUser.invalid) return;
    const { userName, email } = this.newUser.getRawValue();
    this.api.addNewUserMember(this.projectId(), userName.trim(), email.trim(), this.role.value).subscribe({
      next: (member) => {
        this.added(member);
        this.created.set({ userName: member.userName, email: email.trim() });
      },
      error: (error: HttpErrorResponse) => this.error.set(error.error?.error ?? 'Could not create the user.'),
    });
  }

  protected removeMember(member: ProjectMember): void {
    const name = member.displayName || member.userName;
    if (!confirm(`Remove ${name} from this project? Their todo and doing tasks will be unassigned. Completed tasks will remain assigned to them.`))
      return;

    this.removalError.set('');
    this.removingUserId.set(member.userId);
    this.api.removeMember(this.projectId(), member.userId).subscribe({
      next: () => {
        this.members.update((members) => members.filter((item) => item.userId !== member.userId));
        this.project.reload();
        this.removingUserId.set(null);
      },
      error: (error: HttpErrorResponse) => {
        this.removalError.set(error.error?.error ?? 'Could not remove the member. Please try again.');
        this.removingUserId.set(null);
      },
    });
  }

  /** The backend deletes the account only when this was the invited user's one project. */
  protected cancelInvite(member: ProjectMember): void {
    const name = member.displayName || member.userName;
    if (!confirm(`Cancel ${name}'s invite? If this is the only project they were invited to, their account is deleted too.`))
      return;

    this.removalError.set('');
    this.removingUserId.set(member.userId);
    this.api.cancelInvite(this.projectId(), member.userId).subscribe({
      next: () => {
        this.members.update((members) => members.filter((item) => item.userId !== member.userId));
        this.project.reload();
        this.removingUserId.set(null);
      },
      error: (error: HttpErrorResponse) => {
        this.removalError.set(error.error?.error ?? 'Could not cancel the invite. Please try again.');
        this.removingUserId.set(null);
      },
    });
  }

  private added(member: ProjectMember): void {
    this.members.update((members) => [...members, member]);
    this.project.reload();
  }
}
