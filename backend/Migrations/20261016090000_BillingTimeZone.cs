using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <summary>
    /// Billing counts days and months in the project's time zone instead of UTC. Existing projects start empty, which
    /// still means UTC, until the owner saves the billing settings (the settings form fills in their browser's zone).
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261016090000_BillingTimeZone")]
    public partial class BillingTimeZone : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BillingTimeZone",
                table: "Projects",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "TEXT" : "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BillingTimeZone",
                table: "Projects");
        }
    }
}
