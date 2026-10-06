using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class OverviewTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CompletedAt",
                table: "ProjectTasks",
                type: sqlite ? "TEXT" : "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WorkSessions",
                columns: table => new
                {
                    Id = table.Column<long>(type: sqlite ? "INTEGER" : "bigint", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<long>(type: sqlite ? "INTEGER" : "bigint", nullable: false),
                    UserId = table.Column<string>(type: sqlite ? "TEXT" : "text", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: sqlite ? "TEXT" : "timestamp with time zone", nullable: false),
                    EndedAt = table.Column<DateTimeOffset>(type: sqlite ? "TEXT" : "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkSessions_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WorkSessions_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkSessions_ProjectId",
                table: "WorkSessions",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkSessions_UserId",
                table: "WorkSessions",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "CompletedAt",
                table: "ProjectTasks");
        }
    }
}
