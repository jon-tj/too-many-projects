using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class TaskUpdatedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UpdatedAt",
                table: "ProjectTasks",
                type: sqlite ? "TEXT" : "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UpdatedByUserId",
                table: "ProjectTasks",
                type: sqlite ? "TEXT" : "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "ProjectTasks");

            migrationBuilder.DropColumn(
                name: "UpdatedByUserId",
                table: "ProjectTasks");
        }
    }
}
