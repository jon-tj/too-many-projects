using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;

namespace Plans;

/// <summary>What an endpoint needs from its project's plan.</summary>
public enum ProjectFeature
{
    /// <summary>Boards and tasks: any plan, as long as the project is not frozen.</summary>
    Tasks,
    /// <summary>Everything else (roadmap, canvas, time tracking, billing, members): not on the free plan.</summary>
    Full,
}

/// <summary>Which route value identifies the project, directly or through something in it.</summary>
public enum ProjectKey
{
    /// <summary>The "projectId" route value.</summary>
    ProjectId,
    /// <summary>The "id" route value is the project's id.</summary>
    Id,
    /// <summary>The "id" route value is a task in the project.</summary>
    TaskId,
    /// <summary>The "id" route value is a work session in the project.</summary>
    WorkSessionId,
}

/// <summary>
/// Refuses the request with 403 when the project is frozen, or when the endpoint needs full features and the
/// project's owner is on the free plan. The method's attribute wins over the controller's; without either, nothing
/// is checked. Projects that cannot be found are left to the endpoint, which answers 404 as before.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequiresProjectAttribute(ProjectFeature feature, ProjectKey key = ProjectKey.ProjectId) : Attribute
{
    public ProjectFeature Feature { get; } = feature;
    public ProjectKey Key { get; } = key;
}

/// <summary>Opts an endpoint out of its controller's <see cref="RequiresProjectAttribute"/>, e.g. listing or deleting projects.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class AnyProjectStateAttribute : Attribute;

/// <summary>Enforces <see cref="RequiresProjectAttribute"/> for every controller action.</summary>
public sealed class ProjectFeatureFilter(AppDbContext db, PlanService plans) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var metadata = context.ActionDescriptor.EndpointMetadata;
        var requirement = metadata.OfType<AnyProjectStateAttribute>().Any()
            ? null
            // Endpoint metadata lists the controller's attributes before the method's, so the last one is the most specific.
            : metadata.OfType<RequiresProjectAttribute>().LastOrDefault();
        if (requirement is not null && await ResolveProjectId(context, requirement.Key) is { } projectId
            && await plans.GetStatus(projectId, context.HttpContext.RequestAborted) is { } status)
        {
            if (status.Frozen)
            {
                context.Result = Refuse("frozen",
                    "This project is frozen. Its owner needs to choose a plan that includes it to use it again.");
                return;
            }
            if (requirement.Feature == ProjectFeature.Full && !status.FullFeatures)
            {
                context.Result = Refuse("plan",
                    "The free plan includes boards and tasks only. Upgrade the plan to use this.");
                return;
            }
        }
        await next();
    }

    private async Task<long?> ResolveProjectId(ActionExecutingContext context, ProjectKey key)
    {
        var routeName = key == ProjectKey.ProjectId ? "projectId" : "id";
        if (!long.TryParse(context.RouteData.Values[routeName]?.ToString(), out var value)) return null;
        var cancellationToken = context.HttpContext.RequestAborted;
        return key switch
        {
            ProjectKey.TaskId => await db.ProjectTasks.Where(task => task.Id == value)
                .Select(task => (long?)task.ProjectId).SingleOrDefaultAsync(cancellationToken),
            ProjectKey.WorkSessionId => await db.WorkSessions.Where(session => session.Id == value)
                .Select(session => (long?)session.ProjectId).SingleOrDefaultAsync(cancellationToken),
            _ => value,
        };
    }

    private static ObjectResult Refuse(string code, string error) =>
        new(new { error, code }) { StatusCode = StatusCodes.Status403Forbidden };
}
