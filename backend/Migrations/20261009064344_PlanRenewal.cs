using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class PlanRenewal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";

            migrationBuilder.RenameColumn(
                name: "TrialEndsAt",
                table: "AspNetUsers",
                newName: "PlanRenewDate");

            migrationBuilder.RenameColumn(
                name: "Plan",
                table: "AspNetUsers",
                newName: "PlanType");

            // Every plan but free now runs out at its renew date. Accounts from before plans existed have none, which
            // would count as run out, so they get until 8 November 2026 (30 days) to choose a plan. The admin is exempt.
            migrationBuilder.Sql(
                "UPDATE \"AspNetUsers\" SET \"PlanRenewDate\" = '2026-11-08 00:00:00+00:00' " +
                "WHERE \"PlanType\" <> 'free' AND \"PlanRenewDate\" IS NULL;");

            migrationBuilder.CreateTable(
                name: "PlanExemptions",
                columns: table => new
                {
                    UserId = table.Column<string>(type: sqlite ? "TEXT" : "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: sqlite ? "TEXT" : "timestamp with time zone", nullable: false),
                    Note = table.Column<string>(type: sqlite ? "TEXT" : "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlanExemptions", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_PlanExemptions_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlanExemptions");

            migrationBuilder.RenameColumn(
                name: "PlanType",
                table: "AspNetUsers",
                newName: "Plan");

            migrationBuilder.RenameColumn(
                name: "PlanRenewDate",
                table: "AspNetUsers",
                newName: "TrialEndsAt");
        }
    }
}
